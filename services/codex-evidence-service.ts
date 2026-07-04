import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export const codexEvidenceDisclaimer =
  "Codex-assisted labels are based on repository evidence selected by the user and optional user notes. Storro does not claim private Codex session access.";

export async function markGitHubContextAsCodexAssisted(
  context: ScopedContext,
  input: {
    projectId: string;
    sourceDocumentIds: string[];
    summary: string;
    prompts?: string[];
    decisions?: string[];
    fixes?: string[];
    commitRange?: string;
    pullRequestNumbers?: number[];
    branchNames?: string[];
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);

  if (input.sourceDocumentIds.length === 0) {
    throw new ValidationServiceError("Select at least one GitHub source to mark as Codex-assisted.");
  }

  const sources = await db.sourceDocument.findMany({
    where: {
      id: {
        in: input.sourceDocumentIds,
      },
      orgId: context.orgId,
      projectId: input.projectId,
      sourceType: {
        in: ["GITHUB_COMMIT", "GITHUB_PULL_REQUEST"],
      },
      deletedAt: null,
    },
  });

  if (sources.length !== input.sourceDocumentIds.length) {
    throw new NotFoundError("One or more GitHub sources were not found.");
  }

  const codexEvidence = buildCodexEvidence(context, input);
  const updated = [];

  for (const source of sources) {
    updated.push(
      await db.sourceDocument.update({
        where: {
          id: source.id,
        },
        data: {
          tags: [...new Set([...source.tags, "codex-assisted"])],
          metadata: {
            ...(isRecord(source.metadata) ? source.metadata : {}),
            codexEvidence,
          } as Prisma.InputJsonObject,
        },
      }),
    );
  }

  const note = await createSourceDocument(
    context,
    {
      projectId: input.projectId,
      title: "Codex-assisted evidence note",
      body: renderCodexEvidenceNote(input),
      sourceType: "CODEX_NOTE",
      tags: ["codex-assisted", "user-note"],
      provenance: {
        kind: "codex",
        actor: context.userId,
        importedAt: new Date(),
      },
      metadata: {
        codexEvidence,
        linkedSourceDocumentIds: input.sourceDocumentIds,
      },
      isPrivate: true,
    },
    db,
  );

  return {
    sources: updated,
    note,
    disclaimer: codexEvidenceDisclaimer,
  };
}

export async function getExtractionFactCodexProvenance(
  context: ScopedContext,
  input: {
    factId: string;
    projectId?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  const fact = await db.extractionFact.findFirst({
    where: {
      id: input.factId,
      orgId: context.orgId,
      projectId: input.projectId,
    },
  });

  if (!fact) {
    throw new NotFoundError("Extraction fact not found.");
  }

  const sources = await db.sourceDocument.findMany({
    where: {
      id: {
        in: fact.sourceIds,
      },
      orgId: context.orgId,
      projectId: fact.projectId,
    },
  });

  return sources
    .map((source) => ({
      sourceId: source.id,
      title: source.title,
      codexEvidence: isRecord(source.metadata) ? source.metadata.codexEvidence : undefined,
    }))
    .filter((item) => item.codexEvidence);
}

function buildCodexEvidence(
  context: ScopedContext,
  input: {
    summary: string;
    prompts?: string[];
    decisions?: string[];
    fixes?: string[];
    commitRange?: string;
    pullRequestNumbers?: number[];
    branchNames?: string[];
  },
) {
  return {
    classification: "CODEX_ASSISTED",
    visibleLabel: "Codex-assisted (user-marked)",
    evidenceBasis: "repository_data_and_user_notes",
    noHiddenAccessClaim: true,
    disclaimer: codexEvidenceDisclaimer,
    summary: input.summary,
    prompts: input.prompts ?? [],
    decisions: input.decisions ?? [],
    fixes: input.fixes ?? [],
    commitRange: input.commitRange,
    pullRequestNumbers: input.pullRequestNumbers ?? [],
    branchNames: input.branchNames ?? [],
    markedById: context.userId,
    markedAt: new Date().toISOString(),
  };
}

function renderCodexEvidenceNote(input: {
  summary: string;
  prompts?: string[];
  decisions?: string[];
  fixes?: string[];
  commitRange?: string;
  pullRequestNumbers?: number[];
  branchNames?: string[];
}) {
  return [
    "# Codex-assisted evidence note",
    "",
    codexEvidenceDisclaimer,
    "",
    "## Summary",
    input.summary,
    "",
    "## Repository scope",
    `Commit range: ${input.commitRange ?? "not specified"}`,
    `Pull requests: ${(input.pullRequestNumbers ?? []).join(", ") || "not specified"}`,
    `Branches: ${(input.branchNames ?? []).join(", ") || "not specified"}`,
    "",
    "## Prompts",
    ...formatList(input.prompts),
    "",
    "## Decisions",
    ...formatList(input.decisions),
    "",
    "## Fixes",
    ...formatList(input.fixes),
  ].join("\n");
}

function formatList(items?: string[]) {
  return items && items.length > 0 ? items.map((item) => `- ${item}`) : ["- not specified"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
