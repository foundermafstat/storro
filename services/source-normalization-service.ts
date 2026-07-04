import type { Prisma, SourceDocument } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertSourcePermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { getRedactedSourceTextForAi } from "@/services/redaction-service";
import {
  calculateSourceExtractionPriority,
} from "@/services/source-service";
import {
  defaultSourceParserRegistry,
  parseSourceDocumentContent,
  type SourceParserRegistry,
} from "@/services/source-parser-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export async function normalizeSourceDocument(
  context: ScopedContext,
  input: string | { sourceDocumentId: string; projectId?: string },
  registry: SourceParserRegistry = defaultSourceParserRegistry,
  db: DatabaseClient = prisma,
) {
  const sourceDocumentId = typeof input === "string" ? input : input.sourceDocumentId;
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "source.write", db);

  const source = await db.sourceDocument.findFirstOrThrow({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
      deletedAt: null,
    },
  });

  if (typeof input !== "string" && input.projectId && source.projectId !== input.projectId) {
    throw new NotFoundError("Source document not found.");
  }

  const rawText = await getNormalizationText(context, source, db);
  const parsed = await parseSourceDocumentContent(
    {
      sourceType: source.sourceType,
      title: source.title,
      rawObjectKey: source.rawObjectKey,
      rawText,
      metadata: source.metadata,
    },
    registry,
  );
  const normalized = await db.normalizedSource.create({
    data: {
      orgId: source.orgId,
      projectId: source.projectId,
      sourceDocumentId: source.id,
      sourceType: source.sourceType,
      title: source.title,
      body: parsed.text,
      metadata: buildNormalizedMetadata(source, parsed),
      rankingScore: calculateSourceExtractionPriority(source),
      isPrivate: source.isPrivate,
      sourceCreatedAt: parsed.sourceCreatedAt ?? source.sourceCreatedAt,
    },
  });

  return {
    normalized,
    warnings: parsed.warnings,
  };
}

export async function normalizeProjectSources(
  context: ScopedContext,
  projectId: string,
  registry: SourceParserRegistry = defaultSourceParserRegistry,
  db: DatabaseClient = prisma,
) {
  const sources = await db.sourceDocument.findMany({
    where: {
      orgId: context.orgId,
      projectId,
      deletedAt: null,
      status: {
        not: "DELETED",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  const results = [];

  for (const source of sources) {
    results.push(await normalizeSourceDocument(context, source.id, registry, db));
  }

  return results;
}

async function getNormalizationText(
  context: ScopedContext,
  source: SourceDocument,
  db: DatabaseClient,
) {
  try {
    return await getRedactedSourceTextForAi(context, source.id, db);
  } catch (error) {
    if (
      error instanceof ValidationServiceError &&
      error.message === "Source must be redacted before AI processing." &&
      source.rawText?.trim()
    ) {
      return source.rawText;
    }

    throw error;
  }
}

function buildNormalizedMetadata(
  source: SourceDocument,
  parsed: Awaited<ReturnType<typeof parseSourceDocumentContent>>,
): Prisma.InputJsonObject {
  return {
    source: {
      id: source.id,
      sourceType: source.sourceType,
      tags: source.tags,
      provenance: isRecord(source.metadata) ? source.metadata.provenance : undefined,
    },
    parser: {
      metadata: parsed.metadata as Prisma.InputJsonObject,
      warnings: parsed.warnings,
      sections: parsed.sections,
      confidence: parsed.confidence,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
