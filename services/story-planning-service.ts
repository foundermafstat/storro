import type { ArtifactFormat, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  callAiGateway,
  type AiGatewayProvider,
  type AiModelPolicy,
} from "@/services/ai-gateway";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { getApprovedFactsForGeneration } from "@/services/extraction-review-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

const storyPlanSchema = z.object({
  titleOptions: z.array(z.string()).min(1),
  hook: z.string(),
  audience: z.string(),
  thesis: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      purpose: z.string(),
      factIds: z.array(z.string()),
    }),
  ),
  factsToUse: z.array(z.string()),
  claimsToAvoid: z.array(z.string()),
  nextStep: z.string(),
  templateConstraints: z.array(z.string()).default([]),
});

export type StoryPlan = z.infer<typeof storyPlanSchema>;

export async function listStoryPlans(
  context: ScopedContext,
  input: {
    projectId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);

  return db.storyRun.findMany({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function generateStoryPlan(
  context: ScopedContext,
  input: {
    projectId: string;
    templateId: string;
    format: ArtifactFormat;
    audience?: string;
    tone?: string;
    publicOnly?: boolean;
    promptVersion?: string;
  },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const facts = await getApprovedFactsForGeneration(
    context,
    {
      projectId: input.projectId,
      publicOnly: input.publicOnly ?? true,
    },
    db,
  );

  if (facts.length === 0) {
    throw new ValidationServiceError("Approved facts are required before story planning.");
  }

  const extractionRunId = facts[0].extractionRunId;
  const storyRun = await db.storyRun.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      extractionRunId,
      createdById: context.userId,
      status: "RUNNING",
      templateId: input.templateId,
      format: input.format,
      audience: input.audience,
      tone: input.tone,
      promptVersion: input.promptVersion ?? "story-plan.v1",
      startedAt: new Date(),
    },
  });

  try {
    const gatewayResult = await callAiGateway(
      context,
      {
        task: "planning",
        projectId: input.projectId,
        promptVersion: input.promptVersion ?? "story-plan.v1",
        messages: [
          {
            role: "system",
            content:
              "Create a story plan using only approved facts. factsToUse and sections.factIds must contain only approved fact ids. Include claims to avoid when context is missing or risky.",
          },
          {
            role: "user",
            content: JSON.stringify({
              format: input.format,
              audience: input.audience,
              tone: input.tone,
              facts: facts.map((fact) => ({
                id: fact.id,
                category: fact.category,
                text: fact.text,
                confidence: fact.confidence,
                sourceIds: fact.sourceIds,
              })),
            }),
          },
        ],
        jsonSchema: {
          name: "storro_story_plan",
          schema: storyPlanJsonSchema,
        },
        maxRetries: 1,
        backoffMs: 0,
      },
      provider,
      modelPolicy,
      db,
    );
    const parsed = storyPlanSchema.safeParse(gatewayResult.parsed);

    if (!parsed.success) {
      throw new ValidationServiceError("Story plan output validation failed.", {
        issues: parsed.error.issues,
      });
    }

    assertPlanUsesOnlyApprovedFactIds(parsed.data, facts.map((fact) => fact.id));

    const updated = await db.storyRun.update({
      where: {
        id: storyRun.id,
      },
      data: {
        status: "NEEDS_REVIEW",
        storyPlan: parsed.data as Prisma.InputJsonObject,
        completedAt: new Date(),
      },
    });

    return {
      storyRun: updated,
      plan: parsed.data,
      factsUsed: facts,
    };
  } catch (error) {
    await db.storyRun.update({
      where: {
        id: storyRun.id,
      },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Story planning failed.",
      },
    });

    throw error;
  }
}

function assertPlanUsesOnlyApprovedFactIds(plan: StoryPlan, approvedFactIds: string[]) {
  const approved = new Set(approvedFactIds);
  const referenced = [
    ...plan.factsToUse,
    ...plan.sections.flatMap((section) => section.factIds),
  ];
  const invalid = referenced.filter((factId) => !approved.has(factId));

  if (invalid.length > 0) {
    throw new ValidationServiceError("Story plan referenced facts that are not approved for generation.", {
      factIds: [...new Set(invalid)],
    });
  }
}

export const storyPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    titleOptions: { type: "array", items: { type: "string" } },
    hook: { type: "string" },
    audience: { type: "string" },
    thesis: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          purpose: { type: "string" },
          factIds: { type: "array", items: { type: "string" } },
        },
        required: ["heading", "purpose", "factIds"],
      },
    },
    factsToUse: { type: "array", items: { type: "string" } },
    claimsToAvoid: { type: "array", items: { type: "string" } },
    nextStep: { type: "string" },
    templateConstraints: { type: "array", items: { type: "string" } },
  },
  required: [
    "titleOptions",
    "hook",
    "audience",
    "thesis",
    "sections",
    "factsToUse",
    "claimsToAvoid",
    "nextStep",
    "templateConstraints",
  ],
};
