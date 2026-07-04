import type { Prisma, SourceType } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertSourcePermission } from "@/services/authorization-service";
import { NotFoundError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ChunkingOptions = {
  maxTokens?: number;
};

export type SourceChunkCandidate = {
  sourceType: SourceType;
  title: string;
  body: string;
  metadata?: Prisma.JsonValue | null;
  rankingScore?: number;
};

export type SourceChunk = {
  chunkIndex: number;
  body: string;
  tokenEstimate: number;
  summary: string;
  metadata: Prisma.InputJsonObject;
};

const defaultMaxTokens = 800;
const importantSourceTypes = new Set<SourceType>([
  "MANUAL_NOTE",
  "GITHUB_PULL_REQUEST",
  "GITHUB_COMMIT",
  "COMMIT_LOG",
  "GIT_DIFF",
]);

export async function chunkNormalizedSource(
  context: ScopedContext,
  input: string | { normalizedSourceId: string; projectId?: string },
  options: ChunkingOptions = {},
  db: DatabaseClient = prisma,
) {
  const normalizedSourceId = typeof input === "string" ? input : input.normalizedSourceId;
  requireScopedContext(context);

  const normalizedSource = await db.normalizedSource.findFirst({
    where: {
      id: normalizedSourceId,
      orgId: context.orgId,
    },
  });

  if (!normalizedSource) {
    throw new NotFoundError("Normalized source not found.");
  }

  if (typeof input !== "string" && input.projectId && normalizedSource.projectId !== input.projectId) {
    throw new NotFoundError("Normalized source not found.");
  }

  await assertSourcePermission(context, normalizedSource.sourceDocumentId, "extraction.write", db);
  await db.normalizedSourceChunk.deleteMany({
    where: {
      normalizedSourceId,
    },
  });

  if (shouldExcludeFromChunking(normalizedSource)) {
    return [];
  }

  const chunks = createSourceChunks(normalizedSource, options);

  return Promise.all(
    chunks.map((chunk) =>
      db.normalizedSourceChunk.create({
        data: {
          orgId: normalizedSource.orgId,
          projectId: normalizedSource.projectId,
          normalizedSourceId: normalizedSource.id,
          chunkIndex: chunk.chunkIndex,
          body: chunk.body,
          tokenEstimate: chunk.tokenEstimate,
          summary: chunk.summary,
          metadata: chunk.metadata,
        },
      }),
    ),
  );
}

export function createSourceChunks(source: SourceChunkCandidate, options: ChunkingOptions = {}) {
  if (shouldExcludeFromChunking(source)) {
    return [];
  }

  const maxTokens = options.maxTokens ?? defaultMaxTokens;
  const segments = splitBySemanticBoundary(source);
  const packed = packSegments(segments, maxTokens);

  return packed.map((body, index) => ({
    chunkIndex: index,
    body,
    tokenEstimate: estimateTokens(body),
    summary: summarizeChunk(body),
    metadata: {
      sourceType: source.sourceType,
      title: source.title,
      chunking: {
        maxTokens,
        boundary: source.sourceType === "GIT_DIFF" ? "git-diff" : "semantic",
      },
    },
  }));
}

export function rankNormalizedSourcesForExtraction<TSource extends SourceChunkCandidate>(sources: TSource[]) {
  return sources
    .filter((source) => !shouldExcludeFromChunking(source))
    .sort((a, b) => calculateNormalizedSourceRank(b) - calculateNormalizedSourceRank(a));
}

export function calculateNormalizedSourceRank(source: SourceChunkCandidate) {
  const base = source.rankingScore ?? 0;
  const manualBoost = source.sourceType === "MANUAL_NOTE" ? 100 : 0;
  const importantBoost = importantSourceTypes.has(source.sourceType) ? 25 : 0;
  const gitBoost = readGitSummary(source.metadata)?.testFiles ? 10 : 0;

  return base + manualBoost + importantBoost + gitBoost;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function shouldExcludeFromChunking(source: SourceChunkCandidate) {
  const title = source.title.toLowerCase();

  if (
    title.includes("node_modules/") ||
    title.includes(".next/") ||
    title.includes("dist/") ||
    title.includes("build/")
  ) {
    return true;
  }

  const gitSummary = readGitSummary(source.metadata);
  return !!gitSummary && gitSummary.filesChanged > 0 && gitSummary.generatedFiles === gitSummary.filesChanged;
}

function splitBySemanticBoundary(source: SourceChunkCandidate) {
  if (source.sourceType === "GIT_DIFF") {
    return source.body
      .split(/(?=^diff --git )/m)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  const headingSegments = source.body
    .split(/(?=^#{1,6}\s+)/m)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (headingSegments.length > 1) {
    return headingSegments;
  }

  return source.body
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function packSegments(segments: string[], maxTokens: number) {
  const chunks: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (estimateTokens(segment) > maxTokens) {
      flushCurrent();
      chunks.push(...splitOversizedSegment(segment, maxTokens));
      continue;
    }

    const next = current ? `${current}\n\n${segment}` : segment;
    if (estimateTokens(next) > maxTokens) {
      flushCurrent();
      current = segment;
      continue;
    }

    current = next;
  }

  flushCurrent();
  return chunks;

  function flushCurrent() {
    if (current) {
      chunks.push(current);
      current = "";
    }
  }
}

function splitOversizedSegment(segment: string, maxTokens: number) {
  const chunks: string[] = [];
  const lines = segment.split(/\r?\n/);
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;

    if (estimateTokens(next) <= maxTokens) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (estimateTokens(line) > maxTokens) {
      chunks.push(...splitByCharacters(line, maxTokens));
    } else {
      current = line;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitByCharacters(text: string, maxTokens: number) {
  const maxChars = maxTokens * 4;
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }

  return chunks;
}

function summarizeChunk(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function readGitSummary(metadata: Prisma.JsonValue | null | undefined) {
  if (!isRecord(metadata) || !isRecord(metadata.parser) || !isRecord(metadata.parser.metadata)) {
    return undefined;
  }

  const git = metadata.parser.metadata.git;

  if (!isRecord(git) || !isRecord(git.summary)) {
    return undefined;
  }

  return {
    filesChanged: readNumber(git.summary.filesChanged),
    generatedFiles: readNumber(git.summary.generatedFiles),
    testFiles: readNumber(git.summary.testFiles),
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
