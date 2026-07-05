import type { ArtifactFormat } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  approveStoryPlan,
  enqueueArtifactGeneration,
  executeArtifactGenerationJob,
} from "@/services/artifact-generation-service";
import {
  type AiGatewayProvider,
  type AiModelPolicy,
} from "@/services/ai-gateway";
import {
  createExtractionRun,
  executeExtractionRun,
} from "@/services/extraction-pipeline-service";
import { listExtractionFacts } from "@/services/extraction-review-service";
import { ValidationServiceError } from "@/services/errors";
import { normalizeSourceDocument } from "@/services/source-normalization-service";
import { generateStoryPlan } from "@/services/story-planning-service";
import { getProjectTimeline } from "@/services/timeline-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type StoryWorkflowInput = {
  projectId: string;
  selectedSourceIds?: string[];
  templateId?: string;
  format?: ArtifactFormat;
  mode?: "private_journal" | "public_update";
  includePrivate?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  limit?: number;
};

export async function prepareStoryContext(
  context: ScopedContext,
  input: StoryWorkflowInput,
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  const selectedSourceIds = await resolveSelectedSourceIds(context, input, db);
  const factsBefore = await listExtractionFacts(context, { projectId: input.projectId }, db);
  const sourceIdsWithFacts = new Set(factsBefore.flatMap((fact) => fact.sourceIds));
  const sourceIdsToExtract = selectedSourceIds.filter((sourceId) => !sourceIdsWithFacts.has(sourceId));
  const normalized = [];
  let extractionResult: Awaited<ReturnType<typeof executeExtractionRun>> | null = null;

  for (const sourceId of await sourceIdsMissingNormalization(context, input.projectId, sourceIdsToExtract, db)) {
    normalized.push(await normalizeSourceDocument(context, { projectId: input.projectId, sourceDocumentId: sourceId }, undefined, db));
  }

  if (sourceIdsToExtract.length > 0) {
    const run = await createExtractionRun(context, { projectId: input.projectId, selectedSourceIds: sourceIdsToExtract }, db);
    extractionResult = await executeExtractionRun(
      context,
      {
        projectId: input.projectId,
        extractionRunId: run.id,
      },
      provider,
      modelPolicy,
      db,
    );
  }

  const factsAfter = await listExtractionFacts(context, { projectId: input.projectId }, db);
  const factCounts = countFacts(factsAfter);
  const templateId = input.templateId ?? "long-article";
  const format = input.format ?? "LONG_ARTICLE";
  const existingPlan = await db.storyRun.findFirst({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      templateId,
      status: {
        in: ["NEEDS_REVIEW", "COMPLETED"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  const planResult = factCounts.approved > 0 && !existingPlan
    ? await generateStoryPlan(
      context,
      {
        projectId: input.projectId,
        templateId,
        format,
        publicOnly: input.mode === "public_update" || format === "LONG_ARTICLE",
      },
      provider,
      modelPolicy,
      db,
    )
    : null;
  const timeline = await getProjectTimeline(
    context,
    {
      projectId: input.projectId,
      mode: input.mode ?? "public_update",
      includePrivate: input.includePrivate,
      createdFrom: input.createdFrom,
      createdTo: input.createdTo,
      limit: input.limit ?? 120,
    },
    db,
  );

  return {
    selectedSourceIds,
    normalizedCount: normalized.length,
    extractionRun: extractionResult?.run ?? null,
    extractedFactCount: extractionResult?.facts.length ?? 0,
    factCounts,
    storyRun: planResult?.storyRun ?? existingPlan ?? null,
    timeline,
    nextStep: factCounts.pending > 0 ? "review_evidence" : factCounts.approved > 0 ? "generate_draft" : "add_context",
  };
}

export async function generateDraftFromStoryContext(
  context: ScopedContext,
  input: Pick<StoryWorkflowInput, "projectId" | "templateId" | "format"> & { promptVersion?: string },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  const templateId = input.templateId ?? "long-article";
  const format = input.format ?? "LONG_ARTICLE";
  let storyRun = await db.storyRun.findFirst({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      templateId,
      status: {
        in: ["NEEDS_REVIEW", "COMPLETED"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!storyRun) {
    storyRun = (await generateStoryPlan(
      context,
      {
        projectId: input.projectId,
        templateId,
        format,
        publicOnly: format === "LONG_ARTICLE",
      },
      provider,
      modelPolicy,
      db,
    )).storyRun;
  }

  if (storyRun.status === "NEEDS_REVIEW") {
    storyRun = await approveStoryPlan(context, { projectId: input.projectId, storyRunId: storyRun.id }, db);
  }

  if (storyRun.status !== "COMPLETED") {
    throw new ValidationServiceError("Reviewed story plan is required before draft generation.");
  }

  const job = await enqueueArtifactGeneration(
    context,
    {
      projectId: input.projectId,
      storyRunId: storyRun.id,
      promptVersion: input.promptVersion,
    },
    db,
  );
  const result = await executeArtifactGenerationJob(
    context,
    {
      projectId: input.projectId,
      jobId: job.id,
    },
    provider,
    modelPolicy,
    db,
  );

  return {
    storyRun,
    job: result.job,
    artifact: result.artifact,
  };
}

async function resolveSelectedSourceIds(context: ScopedContext, input: StoryWorkflowInput, db: DatabaseClient) {
  if (input.selectedSourceIds?.length) {
    return input.selectedSourceIds;
  }

  const sources = await db.sourceDocument.findMany({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      deletedAt: null,
    },
    orderBy: {
      sourceCreatedAt: "desc",
    },
    take: 25,
    select: {
      id: true,
    },
  });

  if (sources.length === 0) {
    throw new ValidationServiceError("Add or connect context before preparing a story.");
  }

  return sources.map((source) => source.id);
}

async function sourceIdsMissingNormalization(
  context: ScopedContext,
  projectId: string,
  sourceIds: string[],
  db: DatabaseClient,
) {
  if (sourceIds.length === 0) {
    return [];
  }

  const sources = await db.sourceDocument.findMany({
    where: {
      orgId: context.orgId,
      projectId,
      id: {
        in: sourceIds,
      },
      deletedAt: null,
    },
    include: {
      normalizedSources: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  return sources.filter((source) => source.normalizedSources.length === 0).map((source) => source.id);
}

function countFacts(facts: Awaited<ReturnType<typeof listExtractionFacts>>) {
  return {
    pending: facts.filter((fact) => fact.reviewStatus === "PENDING").length,
    approved: facts.filter((fact) => fact.reviewStatus === "APPROVED").length,
    rejected: facts.filter((fact) => fact.reviewStatus === "REJECTED").length,
    privateFacts: facts.filter((fact) => fact.isPrivate).length,
  };
}
