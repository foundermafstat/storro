import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  type AiGatewayProvider,
  createAiModelPolicy,
} from "@/services/ai-gateway";
import {
  createExtractionRun,
  executeExtractionRun,
} from "@/services/extraction-pipeline-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelPolicy = createAiModelPolicy({
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
});

let orgId = "";
let userId = "";
let projectId = "";
let sourceDocumentId = "";
let normalizedSourceId = "";
let chunkId = "";
let context: ScopedContext;

function providerWithOutput(outputParsed: unknown): AiGatewayProvider {
  return {
    async createResponse() {
      return {
        id: `resp-${Date.now()}`,
        status: "completed",
        outputParsed,
        usage: {
          totalTokens: 9,
        },
      };
    },
  };
}

describe("structured extraction pipeline", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `extract-user-${suffix}`,
        email: `extract-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Extract Org ${suffix}`,
        slug: `extract-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });

    const project = await createProject(context, {
      name: `Extract Project ${suffix}`,
    });
    const source = await createSourceDocument(context, {
      projectId: project.id,
      title: "Extraction source",
      body: "Implemented source extraction pipeline.",
      sourceType: "MANUAL_NOTE",
      isPrivate: true,
    });
    const normalized = await prisma.normalizedSource.create({
      data: {
        orgId,
        projectId: project.id,
        sourceDocumentId: source.id,
        sourceType: "MANUAL_NOTE",
        title: "Extraction source",
        body: "Implemented source extraction pipeline.",
        isPrivate: true,
      },
    });
    const chunk = await prisma.normalizedSourceChunk.create({
      data: {
        orgId,
        projectId: project.id,
        normalizedSourceId: normalized.id,
        chunkIndex: 0,
        body: "Implemented source extraction pipeline.",
        tokenEstimate: 8,
        summary: "Implemented source extraction pipeline.",
      },
    });

    projectId = project.id;
    sourceDocumentId = source.id;
    normalizedSourceId = normalized.id;
    chunkId = chunk.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("loads normalized chunks, calls AI, validates output, and stores facts", async () => {
    const run = await createExtractionRun(context, {
      projectId,
      selectedSourceIds: [sourceDocumentId],
      promptVersion: "extraction.test",
    });
    const result = await executeExtractionRun(
      context,
      {
        extractionRunId: run.id,
        projectId,
        chunkIds: [chunkId],
      },
      providerWithOutput({
        facts: [
          {
            category: "implementation",
            text: "Source extraction pipeline was implemented.",
            sourceChunkIndexes: [0],
            filePaths: ["services/extraction-pipeline-service.ts"],
            confidence: 0.91,
            isPrivate: false,
            reasoningNote: "Directly stated in chunk.",
          },
        ],
        missingContext: ["deployment evidence"],
        riskFlags: [{ type: "coverage", severity: "medium", message: "Needs E2E coverage." }],
      }),
      modelPolicy,
    );

    expect(result.run.status).toBe("COMPLETED");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      category: "implementation",
      text: "Source extraction pipeline was implemented.",
      sourceIds: [sourceDocumentId],
      filePaths: ["services/extraction-pipeline-service.ts"],
      confidence: 0.91,
      isPrivate: true,
    });
    expect(result.missingContext).toEqual(["deployment evidence"]);
    expect(result.riskFlags).toEqual([{ type: "coverage", severity: "medium", message: "Needs E2E coverage." }]);

    const usage = await prisma.usageEvent.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        type: "AI_EXTRACTION",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(usage.quantity).toBe(9);
    expect(normalizedSourceId).toBeTruthy();
  });

  it("marks runs failed when structured AI output is invalid", async () => {
    const run = await createExtractionRun(context, {
      projectId,
      selectedSourceIds: [sourceDocumentId],
      promptVersion: "extraction.test",
    });

    await expect(
      executeExtractionRun(
        context,
        {
          extractionRunId: run.id,
          projectId,
          chunkIds: [chunkId],
        },
        providerWithOutput({
          facts: [{ text: "missing category and confidence" }],
          missingContext: [],
          riskFlags: [],
        }),
        modelPolicy,
      ),
    ).rejects.toThrow("Structured extraction output validation failed.");

    const failedRun = await prisma.extractionRun.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });

    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.errorMessage).toBe("Structured extraction output validation failed.");
  });
});
