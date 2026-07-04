import type { ExtractionFact, Prisma, ReviewStatus } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertOrgPermission, assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ExtractionFactFilters = {
  projectId: string;
  category?: string;
  sourceId?: string;
  isPrivate?: boolean;
  minConfidence?: number;
  reviewStatus?: ReviewStatus;
};

export type ExtractionFactReviewInput = {
  text?: string;
  category?: string;
  reviewStatus?: ReviewStatus;
  isPrivate?: boolean;
  confidence?: number;
  reasoningNote?: string | null;
};

export async function listExtractionFacts(
  context: ScopedContext,
  filters: ExtractionFactFilters,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, filters.projectId, "extraction.read", db);

  const where: Prisma.ExtractionFactWhereInput = {
    orgId: context.orgId,
    projectId: filters.projectId,
  };

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.sourceId) {
    where.sourceIds = {
      has: filters.sourceId,
    };
  }

  if (filters.isPrivate !== undefined) {
    where.isPrivate = filters.isPrivate;
  }

  if (filters.minConfidence !== undefined) {
    where.confidence = {
      gte: filters.minConfidence,
    };
  }

  if (filters.reviewStatus) {
    where.reviewStatus = filters.reviewStatus;
  }

  return db.extractionFact.findMany({
    where,
    orderBy: [{ reviewStatus: "asc" }, { confidence: "desc" }, { createdAt: "desc" }],
  });
}

export async function updateExtractionFactReview(
  context: ScopedContext,
  factRef: string | { factId: string; projectId?: string },
  input: ExtractionFactReviewInput,
  db: DatabaseClient = prisma,
) {
  const factId = typeof factRef === "string" ? factRef : factRef.factId;
  requireScopedContext(context);
  await assertOrgPermission(context, "extraction.write", db);

  const fact = await getScopedFact(context, factId, db);
  assertFactProject(fact, factRef);

  return db.extractionFact.update({
    where: {
      id: fact.id,
    },
    data: {
      text: input.text,
      category: input.category,
      reviewStatus: input.reviewStatus,
      isPrivate: input.isPrivate,
      confidence: input.confidence,
      reasoningNote: input.reasoningNote,
    },
  });
}

export async function addMissingExtractionFact(
  context: ScopedContext,
  input: {
    projectId: string;
    extractionRunId: string;
    category: string;
    text: string;
    sourceIds: string[];
    filePaths?: string[];
    confidence?: number;
    isPrivate?: boolean;
    reasoningNote?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "extraction.write", db);

  if (input.sourceIds.length === 0) {
    throw new ValidationServiceError("A missing fact must reference at least one source.");
  }

  const run = await db.extractionRun.findFirst({
    where: {
      id: input.extractionRunId,
      orgId: context.orgId,
      projectId: input.projectId,
    },
  });

  if (!run) {
    throw new NotFoundError("Extraction run not found.");
  }

  return db.extractionFact.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      extractionRunId: input.extractionRunId,
      category: input.category,
      text: input.text,
      sourceIds: input.sourceIds,
      filePaths: input.filePaths ?? [],
      confidence: input.confidence ?? 1,
      isPrivate: input.isPrivate ?? false,
      reviewStatus: "APPROVED",
      reasoningNote: input.reasoningNote,
    },
  });
}

export async function getApprovedFactsForGeneration(
  context: ScopedContext,
  input: {
    projectId: string;
    publicOnly?: boolean;
  },
  db: DatabaseClient = prisma,
) {
  const facts = await listExtractionFacts(
    context,
    {
      projectId: input.projectId,
      reviewStatus: "APPROVED",
      isPrivate: input.publicOnly ? false : undefined,
    },
    db,
  );

  return facts;
}

export async function getFactSourceContext(
  context: ScopedContext,
  factRef: string | { factId: string; projectId?: string },
  sourceId: string,
  db: DatabaseClient = prisma,
) {
  const factId = typeof factRef === "string" ? factRef : factRef.factId;
  const fact = await getScopedFact(context, factId, db);
  assertFactProject(fact, factRef);

  if (!fact.sourceIds.includes(sourceId)) {
    throw new NotFoundError("Source reference not found.");
  }

  const source = await db.sourceDocument.findFirst({
    where: {
      id: sourceId,
      orgId: context.orgId,
      projectId: fact.projectId,
    },
    select: {
      id: true,
      title: true,
      sourceType: true,
      rawText: true,
      metadata: true,
    },
  });

  if (!source) {
    throw new NotFoundError("Source document not found.");
  }

  return {
    fact,
    source,
  };
}

async function getScopedFact(context: ScopedContext, factId: string, db: DatabaseClient): Promise<ExtractionFact> {
  const fact = await db.extractionFact.findFirst({
    where: {
      id: factId,
      orgId: context.orgId,
    },
  });

  if (!fact) {
    throw new NotFoundError("Extraction fact not found.");
  }

  return fact;
}

function assertFactProject(fact: ExtractionFact, factRef: string | { factId: string; projectId?: string }) {
  if (typeof factRef !== "string" && factRef.projectId && fact.projectId !== factRef.projectId) {
    throw new NotFoundError("Extraction fact not found.");
  }
}
