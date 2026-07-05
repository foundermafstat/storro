import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createArtifactExport } from "@/services/artifact-export-service";
import {
  approveStoryPlan,
  enqueueArtifactGeneration,
  executeArtifactGenerationJob,
} from "@/services/artifact-generation-service";
import {
  type AiGatewayProvider,
  type AiGatewayProviderRequest,
  createAiModelPolicy,
} from "@/services/ai-gateway";
import { updateExtractionFactReview } from "@/services/extraction-review-service";
import { createExtractionRun, executeExtractionRun } from "@/services/extraction-pipeline-service";
import type { ObjectStorageAdapter } from "@/services/file-upload-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";
import { generateStoryPlan } from "@/services/story-planning-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelPolicy = createAiModelPolicy({
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
});

let orgId = "";
let userId = "";
let context: ScopedContext;

class MemoryStorageAdapter implements ObjectStorageAdapter {
  provider = "memory";
  objects = new Map<string, { body: string; mimeType: string }>();

  async putObject(input: { objectKey: string; body: Uint8Array; mimeType: string }) {
    this.objects.set(input.objectKey, {
      body: new TextDecoder().decode(input.body),
      mimeType: input.mimeType,
    });
  }

  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
  }

  async createSignedUploadUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return `https://signed.local/upload/${input.objectKey}?expires=${input.expiresInSeconds}`;
  }

  async createSignedDownloadUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return `https://signed.local/download/${input.objectKey}?expires=${input.expiresInSeconds}`;
  }
}

function e2eProvider(requests: AiGatewayProviderRequest[]): AiGatewayProvider {
  return {
    async createResponse(request) {
      requests.push(request);

      if (request.jsonSchema?.name === "storro_extraction") {
        return {
          id: `extract-${suffix}`,
          status: "completed",
          outputParsed: {
            facts: [
              {
                category: "implementation",
                text: "Storro imports source notes and turns approved evidence into markdown artifacts.",
                sourceChunkIndexes: [0],
                filePaths: ["docs/build-log.md"],
                confidence: 0.94,
                isPrivate: false,
              },
            ],
            missingContext: [],
            riskFlags: [],
          },
          usage: { totalTokens: 10 },
        };
      }

      if (request.jsonSchema?.name === "storro_story_plan") {
        const payload = JSON.parse(request.messages.find((message) => message.role === "user")?.content ?? "{}");
        const factId = payload.facts[0].id;

        return {
          id: `plan-${suffix}`,
          status: "completed",
          outputParsed: {
            titleOptions: ["Source to artifact flow"],
            hook: "Storro can turn build evidence into a markdown artifact.",
            audience: "builders",
            thesis: "Approved source evidence drives grounded output.",
            sections: [{ heading: "What shipped", purpose: "Summarize the flow", factIds: [factId] }],
            factsToUse: [factId],
            claimsToAvoid: ["Do not claim production deployment."],
            nextStep: "Export markdown.",
            templateConstraints: [],
          },
          usage: { totalTokens: 11 },
        };
      }

      return {
        id: `artifact-${suffix}`,
        status: "completed",
        outputParsed: {
          title: "Source to artifact flow",
          contentMarkdown: "## What shipped\n\nStorro imports source notes and turns approved evidence into markdown artifacts.",
          usedFactIds: [],
        },
        usage: { totalTokens: 12 },
      };
    },
  };
}

describe("project to artifact E2E flow", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `e2e-user-${suffix}`, email: `e2e-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `E2E Org ${suffix}`, slug: `e2e-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates a project, imports sources, extracts facts, generates an artifact, and exports markdown", async () => {
    const requests: AiGatewayProviderRequest[] = [];
    const provider = e2eProvider(requests);
    const storage = new MemoryStorageAdapter();
    const project = await createProject(context, { name: `E2E Project ${suffix}` });
    const source = await createSourceDocument(context, {
      projectId: project.id,
      title: "Build log",
      body: "Storro imports source notes and turns approved evidence into markdown artifacts.",
      sourceType: "MANUAL_NOTE",
      tags: ["e2e"],
    });
    const normalized = await prisma.normalizedSource.create({
      data: {
        orgId,
        projectId: project.id,
        sourceDocumentId: source.id,
        sourceType: source.sourceType,
        title: source.title,
        body: source.rawText ?? "",
      },
    });
    await prisma.normalizedSourceChunk.create({
      data: {
        orgId,
        projectId: project.id,
        normalizedSourceId: normalized.id,
        chunkIndex: 0,
        body: normalized.body,
      },
    });
    const extractionRun = await createExtractionRun(context, {
      projectId: project.id,
      selectedSourceIds: [source.id],
      promptVersion: "e2e.extraction",
    });
    const extraction = await executeExtractionRun(context, { extractionRunId: extractionRun.id, projectId: project.id }, provider, modelPolicy);
    const approvedFact = await updateExtractionFactReview(context, { factId: extraction.facts[0].id, projectId: project.id }, { reviewStatus: "APPROVED" });
    const plan = await generateStoryPlan(
      context,
      {
        projectId: project.id,
        templateId: "daily-build-journal",
        format: "DAILY_BUILD_JOURNAL",
        promptVersion: "e2e.plan",
      },
      provider,
      modelPolicy,
    );
    await approveStoryPlan(context, { projectId: project.id, storyRunId: plan.storyRun.id });
    const job = await enqueueArtifactGeneration(context, { projectId: project.id, storyRunId: plan.storyRun.id, promptVersion: "e2e.generation" });
    const generation = await executeArtifactGenerationJob(context, { projectId: project.id, jobId: job.id }, provider, modelPolicy);
    const readyArtifact = await prisma.storyArtifact.update({
      where: { id: generation.artifact.id },
      data: { status: "EXPORT_READY", groundingState: "PASSED" },
    });
    const exported = await createArtifactExport(
      context,
      {
        projectId: project.id,
        artifactId: readyArtifact.id,
        exportFormat: "MARKDOWN",
      },
      storage,
    );

    expect(approvedFact.reviewStatus).toBe("APPROVED");
    expect(generation.artifact.contentMarkdown).toContain("approved evidence");
    expect(exported.export.status).toBe("EXPORTED");
    expect([...storage.objects.values()][0].body).toContain("Storro imports source notes");
    expect(requests.map((request) => request.promptVersion)).toEqual(expect.arrayContaining(["e2e.extraction", "e2e.plan", "e2e.generation"]));
  });
});
