import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { renderMarkdownPreviewHtml } from "@/services/artifact-editor-service";
import { recordAuditEvent } from "@/services/audit-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import type { ObjectStorageAdapter } from "@/services/file-upload-service";
import { calculateSha256 } from "@/services/file-upload-service";
import { assertArtifactExportReady } from "@/services/grounding-review-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ArtifactExportKind = "MARKDOWN" | "PLAIN_TEXT" | "PDF_HTML" | "RELEASE_NOTES" | "CLIPBOARD";

const exportKindSchema = z.enum(["MARKDOWN", "PLAIN_TEXT", "PDF_HTML", "RELEASE_NOTES", "CLIPBOARD"]);

export async function createArtifactExport(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    exportFormat: ArtifactExportKind;
    revisionId?: string;
    overrideGrounding?: boolean;
    overrideReason?: string;
    expiresInSeconds?: number;
  },
  storage: ObjectStorageAdapter,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);
  const exportFormat = exportKindSchema.parse(input.exportFormat);
  const artifact = await getScopedArtifact(context, input.projectId, input.artifactId, db);

  if (input.overrideGrounding) {
    if (!input.overrideReason || input.overrideReason.trim().length < 10) {
      throw new ValidationServiceError("Grounding override requires a reason.");
    }

    await recordAuditEvent(
      context,
      {
        action: "artifact.export.override",
        entityType: "StoryArtifact",
        entityId: artifact.id,
        projectId: input.projectId,
        metadata: {
          reason: input.overrideReason,
          groundingState: artifact.groundingState,
          status: artifact.status,
          exportFormat,
        },
      },
      db,
    );
  } else {
    await assertArtifactExportReady(context, { projectId: input.projectId, artifactId: artifact.id }, db);
  }

  const revision = await resolveExportRevision(context, input, artifact.contentMarkdown, db);
  const rendered = renderExportContent(artifact.title, revision.contentMarkdown, exportFormat);
  const bytes = new TextEncoder().encode(rendered.content);
  const objectKey = exportFormat === "CLIPBOARD" ? undefined : createExportObjectKey(context, input.projectId, artifact.id, rendered.fileName);
  const expiresInSeconds = normalizeExpiry(input.expiresInSeconds);

  if (objectKey) {
    await storage.putObject({
      objectKey,
      body: bytes,
      mimeType: rendered.mimeType,
      checksumSha256: calculateSha256(bytes),
      metadata: {
        orgId: context.orgId,
        projectId: input.projectId,
        artifactId: artifact.id,
        revisionId: revision.id,
      },
    });
  }

  const exportRecord = await db.artifactExport.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      artifactId: artifact.id,
      revisionId: revision.id,
      format: artifact.format,
      status: "EXPORTED",
      objectKey,
      metadata: {
        exportFormat,
        mimeType: rendered.mimeType,
        fileName: rendered.fileName,
        sizeBytes: bytes.byteLength,
        checksumSha256: calculateSha256(bytes),
        overrideGrounding: input.overrideGrounding ?? false,
      } as Prisma.InputJsonObject,
    },
  });

  const download = objectKey
    ? await createArtifactExportDownloadUrl(context, { projectId: input.projectId, exportId: exportRecord.id, expiresInSeconds }, storage, db)
    : undefined;

  return {
    export: exportRecord,
    content: exportFormat === "CLIPBOARD" ? rendered.content : undefined,
    downloadUrl: download?.downloadUrl,
    expiresInSeconds: download?.expiresInSeconds,
  };
}

export async function createArtifactExportDownloadUrl(
  context: ScopedContext,
  input: {
    projectId: string;
    exportId: string;
    expiresInSeconds?: number;
  },
  storage: ObjectStorageAdapter,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  const exportRecord = await db.artifactExport.findFirst({
    where: {
      id: input.exportId,
      orgId: context.orgId,
      projectId: input.projectId,
    },
  });

  if (!exportRecord || !exportRecord.objectKey) {
    throw new NotFoundError("Artifact export not found.");
  }

  if (!exportRecord.objectKey.startsWith(`orgs/${context.orgId}/projects/${input.projectId}/exports/`)) {
    throw new NotFoundError("Artifact export not found.");
  }

  const expiresInSeconds = normalizeExpiry(input.expiresInSeconds);
  const downloadUrl = await storage.createSignedDownloadUrl({
    objectKey: exportRecord.objectKey,
    expiresInSeconds,
  });

  return {
    export: exportRecord,
    downloadUrl,
    expiresInSeconds,
  };
}

function renderExportContent(title: string, markdown: string, exportFormat: ArtifactExportKind) {
  switch (exportFormat) {
    case "MARKDOWN":
      return {
        content: markdown,
        mimeType: "text/markdown",
        fileName: "artifact.md",
      };
    case "PLAIN_TEXT":
      return {
        content: stripMarkdown(markdown),
        mimeType: "text/plain",
        fileName: "artifact.txt",
      };
    case "PDF_HTML":
      return {
        content: renderPdfReadyHtml(title, markdown),
        mimeType: "text/html",
        fileName: "artifact.html",
      };
    case "RELEASE_NOTES":
      return {
        content: `# ${title}\n\n${markdown.trim()}\n`,
        mimeType: "text/markdown",
        fileName: "release-notes.md",
      };
    case "CLIPBOARD":
      return {
        content: markdown,
        mimeType: "text/plain",
        fileName: "clipboard.txt",
      };
  }
}

async function resolveExportRevision(
  context: ScopedContext,
  input: {
    projectId: string;
    artifactId: string;
    revisionId?: string;
  },
  contentMarkdown: string,
  db: DatabaseClient,
) {
  if (input.revisionId) {
    const revision = await db.editorRevision.findFirst({
      where: {
        id: input.revisionId,
        orgId: context.orgId,
        projectId: input.projectId,
        artifactId: input.artifactId,
      },
    });

    if (!revision) {
      throw new NotFoundError("Editor revision not found.");
    }

    return revision;
  }

  const latest = await db.editorRevision.findFirst({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      artifactId: input.artifactId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (latest?.contentMarkdown === contentMarkdown) {
    return latest;
  }

  return db.editorRevision.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      artifactId: input.artifactId,
      authorId: context.userId,
      contentMarkdown,
      contentHash: calculateSha256(new TextEncoder().encode(contentMarkdown)),
      groundingState: "NOT_REVIEWED",
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

function renderPdfReadyHtml(title: string, markdown: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; max-width: 760px; margin: 48px auto; color: #111827; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
    code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
${renderMarkdownPreviewHtml(markdown)}
</body>
</html>`;
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function createExportObjectKey(context: ScopedContext, projectId: string, artifactId: string, fileName: string) {
  return [
    "orgs",
    context.orgId,
    "projects",
    projectId,
    "exports",
    artifactId,
    `${Date.now()}-${randomUUID()}-${fileName}`,
  ].join("/");
}

function normalizeExpiry(expiresInSeconds = 900) {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) {
    throw new ValidationServiceError("Signed URL expiry must be between 60 and 3600 seconds.");
  }

  return expiresInSeconds;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
