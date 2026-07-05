import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  callAiGateway,
  type AiGatewayProvider,
  type AiModelPolicy,
} from "@/services/ai-gateway";
import { assertOrgPermission, assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { notifyJobCompletion } from "@/services/notification-service";
import { storyPlanSchema, type StoryPlan } from "@/services/story-planning-service";
import { getTemplateDefinition, type TemplateDefinition } from "@/services/template-service";
import { getProjectTimeline } from "@/services/timeline-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

const generationJobPayloadSchema = z.object({
  storyRunId: z.string().uuid(),
  templateId: z.string(),
  format: z.string(),
  promptVersion: z.string(),
});

const artifactOutputSchema = z.object({
  title: z.string().min(1),
  contentMarkdown: z.string().min(1),
  usedFactIds: z.array(z.string()).default([]),
});

export async function approveStoryPlan(
  context: ScopedContext,
  input: {
    projectId: string;
    storyRunId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const storyRun = await getScopedStoryRun(context, input.storyRunId, input.projectId, db);

  if (!storyRun.storyPlan) {
    throw new ValidationServiceError("Story plan is required before approval.");
  }

  return db.storyRun.update({
    where: {
      id: storyRun.id,
    },
    data: {
      status: "COMPLETED",
    },
  });
}

export async function enqueueArtifactGeneration(
  context: ScopedContext,
  input: {
    projectId: string;
    storyRunId: string;
    promptVersion?: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const storyRun = await getScopedStoryRun(context, input.storyRunId, input.projectId, db);

  if (storyRun.status !== "COMPLETED" || !storyRun.storyPlan) {
    throw new ValidationServiceError("Story plan must be approved before artifact generation.");
  }

  return db.job.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      type: "STORY_GENERATION",
      status: "QUEUED",
      queueName: "artifact-generation",
      payload: {
        storyRunId: storyRun.id,
        templateId: storyRun.templateId,
        format: storyRun.format,
        promptVersion: input.promptVersion ?? "artifact-generation.v1",
      },
    },
  });
}

export async function executeArtifactGenerationJob(
  context: ScopedContext,
  input: {
    jobId: string;
    projectId?: string;
  },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "artifact.write", db);

  const job = await db.job.findFirst({
    where: {
      id: input.jobId,
      orgId: context.orgId,
      projectId: input.projectId,
      type: "STORY_GENERATION",
    },
  });

  if (!job) {
    throw new NotFoundError("Artifact generation job not found.");
  }

  const payload = generationJobPayloadSchema.parse(job.payload);

  if (!job.projectId) {
    throw new ValidationServiceError("Artifact generation job must be project-scoped.");
  }

  await db.job.update({
    where: {
      id: job.id,
    },
    data: {
      status: "RUNNING",
      attempts: {
        increment: 1,
      },
      lockedAt: new Date(),
    },
  });

  try {
    const artifact = await generateArtifactFromStoryRun(
      context,
      {
        projectId: job.projectId,
        storyRunId: payload.storyRunId,
        promptVersion: payload.promptVersion,
        jobId: job.id,
      },
      provider,
      modelPolicy,
      db,
    );

    const completed = await db.job.update({
      where: {
        id: job.id,
      },
      data: {
        status: "COMPLETED",
        result: {
          artifactId: artifact.id,
          storyRunId: payload.storyRunId,
        },
      },
    });
    await notifyJobCompletion(context, { jobId: completed.id }, undefined, db);

    return {
      job: completed,
      artifact,
    };
  } catch (error) {
    await db.job.update({
      where: {
        id: job.id,
      },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Artifact generation failed.",
      },
    });

    throw error;
  }
}

export async function generateArtifactFromStoryRun(
  context: ScopedContext,
  input: {
    projectId: string;
    storyRunId: string;
    promptVersion?: string;
    jobId?: string;
  },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const storyRun = await getScopedStoryRun(context, input.storyRunId, input.projectId, db);

  if (storyRun.status !== "COMPLETED" || !storyRun.storyPlan) {
    throw new ValidationServiceError("Story plan must be approved before artifact generation.");
  }

  const plan = parseStoryPlan(storyRun.storyPlan);
  const template = await getTemplateDefinition(
    context,
    {
      projectId: input.projectId,
      templateId: storyRun.templateId,
    },
    db,
  );
  const facts = await loadGenerationFacts(context, input.projectId, plan, template, db);
  const orderedTimelineEvents = await loadApprovedTimelineEvents(context, input.projectId, facts, template, db);
  const promptVersion = input.promptVersion ?? "artifact-generation.v1";
  const gatewayResult = await callAiGateway(
    context,
    {
      task: "generation",
      projectId: input.projectId,
      promptVersion,
      messages: [
        {
          role: "system",
          content:
            "Generate a polished markdown artifact only. Build the narrative around the ordered timeline, cause and effect, and how decisions changed over time. Do not invent claims, metrics, integrations, dates, or outcomes. Preserve uncertainty and follow claimsToAvoid.",
        },
        {
          role: "user",
          content: JSON.stringify({
            template,
            storyPlan: plan,
            approvedFacts: facts.map((fact) => ({
              id: fact.id,
              category: fact.category,
              text: fact.text,
              confidence: fact.confidence,
              filePaths: fact.filePaths,
            })),
            orderedTimelineEvents,
          }),
        },
      ],
      jsonSchema: {
        name: "storro_artifact_generation",
        schema: artifactGenerationJsonSchema,
      },
      maxRetries: 1,
      backoffMs: 0,
    },
    provider,
    modelPolicy,
    db,
  );
  const parsed = artifactOutputSchema.safeParse(gatewayResult.parsed);

  if (!parsed.success) {
    throw new ValidationServiceError("Artifact generation output validation failed.", {
      issues: parsed.error.issues,
    });
  }

  validateMarkdownOnly(parsed.data.contentMarkdown);
  assertUsedFactsAllowed(parsed.data.usedFactIds, facts.map((fact) => fact.id));

  const metadata = {
    model: modelPolicy.generation,
    promptVersion,
    templateId: template.id,
    templateSource: template.source,
    inputFactIds: facts.map((fact) => fact.id),
    usedFactIds: parsed.data.usedFactIds,
    claimsToAvoid: plan.claimsToAvoid,
    jobId: input.jobId,
  };

  const artifact = await db.storyArtifact.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      storyRunId: storyRun.id,
      format: storyRun.format,
      status: "DRAFT",
      title: parsed.data.title,
      contentMarkdown: parsed.data.contentMarkdown,
      model: modelPolicy.generation,
      promptVersion,
      metadata: metadata as Prisma.InputJsonObject,
    },
  });

  await db.editorRevision.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      artifactId: artifact.id,
      authorId: context.userId,
      contentMarkdown: parsed.data.contentMarkdown,
      contentHash: hashMarkdown(parsed.data.contentMarkdown),
      groundingState: "NOT_REVIEWED",
    },
  });

  return artifact;
}

function parseStoryPlan(value: Prisma.JsonValue): StoryPlan {
  const parsed = storyPlanSchema.safeParse(value);

  if (!parsed.success) {
    throw new ValidationServiceError("Stored story plan is invalid.", {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

async function getScopedStoryRun(
  context: ScopedContext,
  storyRunId: string,
  projectId: string,
  db: DatabaseClient,
) {
  const storyRun = await db.storyRun.findFirst({
    where: {
      id: storyRunId,
      orgId: context.orgId,
      projectId,
    },
  });

  if (!storyRun) {
    throw new NotFoundError("Story plan not found.");
  }

  return storyRun;
}

async function loadGenerationFacts(
  context: ScopedContext,
  projectId: string,
  plan: StoryPlan,
  template: TemplateDefinition,
  db: DatabaseClient,
) {
  const factIds = [...new Set([...plan.factsToUse, ...plan.sections.flatMap((section) => section.factIds)])];

  if (factIds.length === 0) {
    throw new ValidationServiceError("Story plan must reference approved facts before artifact generation.");
  }

  const facts = await db.extractionFact.findMany({
    where: {
      id: {
        in: factIds,
      },
      orgId: context.orgId,
      projectId,
      reviewStatus: "APPROVED",
      isPrivate: template.privateFactPolicy === "PUBLIC_ONLY" ? false : undefined,
    },
  });

  if (facts.length !== factIds.length) {
    throw new ValidationServiceError("Story plan references facts unavailable under template policy.", {
      expectedFactIds: factIds,
      availableFactIds: facts.map((fact) => fact.id),
    });
  }

  return facts;
}

async function loadApprovedTimelineEvents(
  context: ScopedContext,
  projectId: string,
  facts: Awaited<ReturnType<typeof loadGenerationFacts>>,
  template: TemplateDefinition,
  db: DatabaseClient,
) {
  const approvedSourceIds = new Set(facts.flatMap((fact) => fact.sourceIds));

  if (approvedSourceIds.size === 0) {
    return [];
  }

  const timeline = await getProjectTimeline(
    context,
    {
      projectId,
      mode: template.privateFactPolicy === "PUBLIC_ONLY" ? "public_update" : "private_journal",
      includePrivate: template.privateFactPolicy !== "PUBLIC_ONLY",
      limit: 200,
    },
    db,
  );

  return timeline.events
    .filter((event) => !event.sourceType || approvedSourceIds.has(event.entityId))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .slice(0, 80)
    .map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      title: event.title,
      summary: event.summary,
      sourceType: event.sourceType,
      isPrivate: event.isPrivate,
    }));
}

function validateMarkdownOnly(markdown: string) {
  const trimmed = markdown.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[") || /<\/?(html|body|script)\b/i.test(trimmed)) {
    throw new ValidationServiceError("Generated artifact must be markdown only.");
  }
}

function assertUsedFactsAllowed(usedFactIds: string[], allowedFactIds: string[]) {
  const allowed = new Set(allowedFactIds);
  const invalid = usedFactIds.filter((factId) => !allowed.has(factId));

  if (invalid.length > 0) {
    throw new ValidationServiceError("Generated artifact referenced facts outside generation input.", {
      factIds: invalid,
    });
  }
}

function hashMarkdown(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex");
}

export const artifactGenerationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    contentMarkdown: { type: "string" },
    usedFactIds: { type: "array", items: { type: "string" } },
  },
  required: ["title", "contentMarkdown", "usedFactIds"],
};
