import type { SourceType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type MemorySearchInput = {
  projectId: string;
  query: string;
  sourceType?: SourceType;
  tags?: string[];
  includePrivate?: boolean;
  retrievalMode?: "workspace" | "public_generation";
  createdFrom?: Date;
  createdTo?: Date;
  minConfidence?: number;
  limit?: number;
};

type MemorySearchRow = {
  itemId: string;
  itemType: string;
  title: string;
  snippet: string;
  sourceType: string | null;
  tags: string[];
  isPrivate: boolean;
  confidence: number;
  rank: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: Prisma.JsonValue;
};

export async function searchProjectMemory(
  context: ScopedContext,
  input: MemorySearchInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "project.read", db);

  const query = normalizeSearchQuery(input.query);
  const includePrivate = input.retrievalMode === "public_generation" ? false : input.includePrivate ?? true;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const tags = normalizeTags(input.tags);

  const rows = await db.$queryRaw<MemorySearchRow[]>(Prisma.sql`
    WITH memory AS (
      SELECT
        "id" AS "itemId",
        'source_document' AS "itemType",
        "title" AS "title",
        concat_ws(E'\n', "title", coalesce("rawText", '')) AS "searchText",
        left(coalesce("rawText", "title"), 480) AS "fallbackSnippet",
        "sourceType"::text AS "sourceType",
        "tags" AS "tags",
        "isPrivate" AS "isPrivate",
        1.0::double precision AS "confidence",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt",
        coalesce("metadata", '{}'::jsonb) AS "metadata"
      FROM "SourceDocument"
      WHERE "orgId" = ${context.orgId}
        AND "projectId" = ${input.projectId}
        AND "deletedAt" IS NULL

      UNION ALL

      SELECT
        "id" AS "itemId",
        'normalized_source' AS "itemType",
        "title" AS "title",
        concat_ws(E'\n', "title", "body") AS "searchText",
        left("body", 480) AS "fallbackSnippet",
        "sourceType"::text AS "sourceType",
        ARRAY[]::text[] AS "tags",
        "isPrivate" AS "isPrivate",
        greatest(0.0, least(1.0, "rankingScore"))::double precision AS "confidence",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt",
        coalesce("metadata", '{}'::jsonb) AS "metadata"
      FROM "NormalizedSource"
      WHERE "orgId" = ${context.orgId}
        AND "projectId" = ${input.projectId}

      UNION ALL

      SELECT
        "id" AS "itemId",
        'extraction_fact' AS "itemType",
        "category" AS "title",
        concat_ws(E'\n', "category", "text", array_to_string("filePaths", ' ')) AS "searchText",
        left("text", 480) AS "fallbackSnippet",
        NULL::text AS "sourceType",
        ARRAY[]::text[] AS "tags",
        "isPrivate" AS "isPrivate",
        "confidence"::double precision AS "confidence",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt",
        jsonb_build_object('sourceIds', "sourceIds", 'filePaths', "filePaths", 'reviewStatus', "reviewStatus") AS "metadata"
      FROM "ExtractionFact"
      WHERE "orgId" = ${context.orgId}
        AND "projectId" = ${input.projectId}

      UNION ALL

      SELECT
        "id" AS "itemId",
        'story_plan' AS "itemType",
        concat('Story plan ', "templateId") AS "title",
        concat_ws(E'\n', "templateId", coalesce("audience", ''), coalesce("tone", ''), coalesce("storyPlan"::text, '')) AS "searchText",
        left(coalesce("storyPlan"::text, "templateId"), 480) AS "fallbackSnippet",
        NULL::text AS "sourceType",
        ARRAY[]::text[] AS "tags",
        false AS "isPrivate",
        1.0::double precision AS "confidence",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt",
        jsonb_build_object('status', "status", 'format', "format", 'templateId', "templateId") AS "metadata"
      FROM "StoryRun"
      WHERE "orgId" = ${context.orgId}
        AND "projectId" = ${input.projectId}
        AND "storyPlan" IS NOT NULL

      UNION ALL

      SELECT
        "id" AS "itemId",
        'story_artifact' AS "itemType",
        "title" AS "title",
        concat_ws(E'\n', "title", "contentMarkdown") AS "searchText",
        left("contentMarkdown", 480) AS "fallbackSnippet",
        NULL::text AS "sourceType",
        ARRAY[]::text[] AS "tags",
        false AS "isPrivate",
        1.0::double precision AS "confidence",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt",
        jsonb_build_object('status', "status", 'format', "format", 'groundingState', "groundingState") AS "metadata"
      FROM "StoryArtifact"
      WHERE "orgId" = ${context.orgId}
        AND "projectId" = ${input.projectId}
        AND "archivedAt" IS NULL
    )
    SELECT
      "itemId",
      "itemType",
      "title",
      ts_headline('simple', "searchText", websearch_to_tsquery('simple', ${query}), 'MaxWords=24, MinWords=8') AS "snippet",
      "sourceType",
      "tags",
      "isPrivate",
      "confidence",
      ts_rank_cd(to_tsvector('simple', "searchText"), websearch_to_tsquery('simple', ${query}))::double precision AS "rank",
      "createdAt",
      "updatedAt",
      "metadata"
    FROM memory
    WHERE to_tsvector('simple', "searchText") @@ websearch_to_tsquery('simple', ${query})
      ${includePrivate ? Prisma.empty : Prisma.sql`AND "isPrivate" = false`}
      ${input.sourceType ? Prisma.sql`AND "sourceType" = ${input.sourceType}` : Prisma.empty}
      ${input.createdFrom ? Prisma.sql`AND "createdAt" >= ${input.createdFrom}` : Prisma.empty}
      ${input.createdTo ? Prisma.sql`AND "createdAt" <= ${input.createdTo}` : Prisma.empty}
      ${input.minConfidence === undefined ? Prisma.empty : Prisma.sql`AND "confidence" >= ${input.minConfidence}`}
      ${tags.length ? Prisma.sql`AND "tags" && ARRAY[${Prisma.join(tags)}]::text[]` : Prisma.empty}
    ORDER BY "rank" DESC, "updatedAt" DESC
    LIMIT ${limit}
  `);

  return {
    query,
    projectId: input.projectId,
    retrievalMode: input.retrievalMode ?? "workspace",
    includePrivate,
    embeddings: {
      provider: process.env.STORRO_PGVECTOR_ENABLED === "true" ? "pgvector" : "disabled",
      optional: true,
    },
    results: rows.map((row) => ({
      ...row,
      snippet: row.snippet || row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function retrievePublicGenerationMemory(
  context: ScopedContext,
  input: Omit<MemorySearchInput, "includePrivate" | "retrievalMode">,
  db: DatabaseClient = prisma,
) {
  return searchProjectMemory(context, {
    ...input,
    includePrivate: false,
    retrievalMode: "public_generation",
  }, db);
}

function normalizeSearchQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");

  if (normalized.length < 2) {
    throw new ValidationServiceError("Search query must contain at least two characters.");
  }

  return normalized.slice(0, 240);
}

function normalizeTags(tags: string[] | undefined) {
  if (!tags?.length) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}
