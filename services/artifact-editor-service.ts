import { createHash } from "crypto";
import type { GroundingState, Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type SaveMode = "autosave" | "manual" | "restore";

export type RevisionDiffLine = {
  type: "equal" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export async function getArtifactEditorView(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  const artifact = await getScopedArtifact(context, input.projectId, input.artifactId, db);
  const revisions = await db.editorRevision.findMany({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      artifactId: artifact.id,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  const facts = await loadSidebarFacts(context, input.projectId, artifact.metadata, db);

  return {
    artifact,
    revisions,
    previewHtml: renderMarkdownPreviewHtml(artifact.contentMarkdown),
    facts,
    groundingReview: isRecord(artifact.metadata) ? artifact.metadata.groundingReview : undefined,
    exportReady: artifact.status === "EXPORT_READY" && artifact.groundingState !== "FAILED",
  };
}

export async function saveArtifactRevision(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    contentMarkdown: string;
    saveMode: SaveMode;
    groundingState?: GroundingState;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  if (!input.contentMarkdown.trim()) {
    throw new ValidationServiceError("Artifact content cannot be empty.");
  }

  const artifact = await getScopedArtifact(context, input.projectId, input.artifactId, db);
  const groundingState = input.groundingState ?? "NOT_REVIEWED";
  const metadata = {
    ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
    editor: {
      lastSaveMode: input.saveMode,
      lastSavedAt: new Date().toISOString(),
      lastSavedById: context.userId,
    },
  };

  const [updated, revision] = await db.$transaction(async (tx) => {
    const updatedArtifact = await tx.storyArtifact.update({
      where: {
        id: artifact.id,
      },
      data: {
        contentMarkdown: input.contentMarkdown,
        groundingState,
        status: groundingState === "FAILED" ? "REVIEW_REQUIRED" : "DRAFT",
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
    const createdRevision = await tx.editorRevision.create({
      data: {
        orgId: context.orgId,
        projectId: input.projectId,
        artifactId: artifact.id,
        authorId: context.userId,
        contentMarkdown: input.contentMarkdown,
        contentHash: hashMarkdown(input.contentMarkdown),
        groundingState,
      },
    });

    return [updatedArtifact, createdRevision] as const;
  });

  return {
    artifact: updated,
    revision,
  };
}

export async function restoreArtifactRevision(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    revisionId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const revision = await getScopedRevision(context, input.projectId, input.artifactId, input.revisionId, db);
  const restored = await saveArtifactRevision(
    context,
    {
      projectId: input.projectId,
      artifactId: input.artifactId,
      contentMarkdown: revision.contentMarkdown,
      groundingState: revision.groundingState,
      saveMode: "restore",
    },
    db,
  );

  await db.storyArtifact.update({
    where: {
      id: input.artifactId,
    },
    data: {
      metadata: {
        ...(isRecord(restored.artifact.metadata) ? restored.artifact.metadata : {}),
        editor: {
          ...(isRecord(restored.artifact.metadata) && isRecord(restored.artifact.metadata.editor)
            ? restored.artifact.metadata.editor
            : {}),
          restoredFromRevisionId: revision.id,
        },
      } as Prisma.InputJsonObject,
    },
  });

  return restored;
}

export async function diffArtifactRevisions(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    baseRevisionId: string;
    compareRevisionId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  const [base, compare] = await Promise.all([
    getScopedRevision(context, input.projectId, input.artifactId, input.baseRevisionId, db),
    getScopedRevision(context, input.projectId, input.artifactId, input.compareRevisionId, db),
  ]);

  return diffLines(base.contentMarkdown, compare.contentMarkdown);
}

export function renderMarkdownPreviewHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index);
      html.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^[-*]\s+/, ""))}</li>`);
        index += 1;
      }

      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const paragraph: string[] = [];

    while (index < lines.length && lines[index].trim() && !isBlockBoundary(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

function diffLines(baseMarkdown: string, compareMarkdown: string): RevisionDiffLine[] {
  const base = baseMarkdown.split("\n");
  const compare = compareMarkdown.split("\n");
  const table = Array.from({ length: base.length + 1 }, () => Array(compare.length + 1).fill(0) as number[]);

  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = compare.length - 1; j >= 0; j -= 1) {
      table[i][j] = base[i] === compare[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const diff: RevisionDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < base.length && j < compare.length) {
    if (base[i] === compare[j]) {
      diff.push({ type: "equal", text: base[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      diff.push({ type: "removed", text: base[i], oldLine: i + 1 });
      i += 1;
    } else {
      diff.push({ type: "added", text: compare[j], newLine: j + 1 });
      j += 1;
    }
  }

  while (i < base.length) {
    diff.push({ type: "removed", text: base[i], oldLine: i + 1 });
    i += 1;
  }

  while (j < compare.length) {
    diff.push({ type: "added", text: compare[j], newLine: j + 1 });
    j += 1;
  }

  return diff;
}

async function loadSidebarFacts(
  context: ScopedContext,
  projectId: string,
  metadata: Prisma.JsonValue,
  db: DatabaseClient,
) {
  if (!isRecord(metadata) || !Array.isArray(metadata.inputFactIds)) {
    return [];
  }

  return db.extractionFact.findMany({
    where: {
      id: {
        in: metadata.inputFactIds.filter((value): value is string => typeof value === "string"),
      },
      orgId: context.orgId,
      projectId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function getScopedArtifact(context: ScopedContext, projectId: string, artifactId: string, db: DatabaseClient) {
  const artifact = await db.storyArtifact.findFirst({
    where: {
      id: artifactId,
      orgId: context.orgId,
      projectId,
      archivedAt: null,
    },
  });

  if (!artifact) {
    throw new NotFoundError("Artifact not found.");
  }

  return artifact;
}

async function getScopedRevision(
  context: ScopedContext,
  projectId: string,
  artifactId: string,
  revisionId: string,
  db: DatabaseClient,
) {
  const revision = await db.editorRevision.findFirst({
    where: {
      id: revisionId,
      orgId: context.orgId,
      projectId,
      artifactId,
    },
  });

  if (!revision) {
    throw new NotFoundError("Editor revision not found.");
  }

  return revision;
}

function isTableStart(lines: string[], index: number) {
  return isTableRow(lines[index]) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function parseTable(lines: string[], index: number) {
  const headers = splitTableRow(lines[index]);
  let cursor = index + 2;
  const rows: string[][] = [];

  while (cursor < lines.length && isTableRow(lines[cursor])) {
    rows.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }

  const html = [
    "<table>",
    `<thead><tr>${headers.map((header) => `<th>${renderInlineMarkdown(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows
      .map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] ?? "")}</td>`).join("")}</tr>`)
      .join("")}</tbody>`,
    "</table>",
  ].join("");

  return {
    html,
    nextIndex: cursor,
  };
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableRow(line: string) {
  return line.includes("|") && line.trim().split("|").length >= 2;
}

function isBlockBoundary(lines: string[], index: number) {
  return /^(#{1,6})\s+/.test(lines[index]) || /^[-*]\s+/.test(lines[index]) || isTableStart(lines, index);
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function hashMarkdown(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
