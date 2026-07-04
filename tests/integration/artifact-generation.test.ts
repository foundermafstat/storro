import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  type AiGatewayProvider,
  createAiModelPolicy,
  type AiGatewayProviderRequest,
} from "@/services/ai-gateway";
import {
  approveStoryPlan,
  enqueueArtifactGeneration,
  executeArtifactGenerationJob,
} from "@/services/artifact-generation-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const modelPolicy = createAiModelPolicy({
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
});

let orgId = "";
let userId = "";
let projectId = "";
let extractionRunId = "";
let publicFactId = "";
let privateFactId = "";
let context: ScopedContext;

function providerWithArtifact(outputParsed: unknown, requests: AiGatewayProviderRequest[]): AiGatewayProvider {
  return {
    async createResponse(request) {
      requests.push(request);

      return {
        id: `resp-${Date.now()}`,
        status: "completed",
        outputParsed,
        usage: {
          totalTokens: 17,
        },
      };
    },
  };
}

describe("artifact generation service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `artifact-user-${suffix}`,
        email: `artifact-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Artifact Org ${suffix}`,
        slug: `artifact-org-${suffix}`,
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
      name: `Artifact Project ${suffix}`,
    });
    const run = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [],
      },
    });
    const publicFact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "implementation",
        text: "The production artifact engine stores markdown with metadata.",
        sourceIds: [],
        filePaths: ["services/artifact-generation-service.ts"],
        confidence: 0.93,
        isPrivate: false,
        reviewStatus: "APPROVED",
      },
    });
    const privateFact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "implementation",
        text: "Private internal implementation note.",
        sourceIds: [],
        filePaths: ["private.md"],
        confidence: 0.97,
        isPrivate: true,
        reviewStatus: "APPROVED",
      },
    });

    projectId = project.id;
    extractionRunId = run.id;
    publicFactId = publicFact.id;
    privateFactId = privateFact.id;
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

  it("queues and executes artifact generation from an approved story plan", async () => {
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId,
        extractionRunId,
        createdById: userId,
        status: "NEEDS_REVIEW",
        templateId: "dorahacks-progress",
        format: "DORAHACKS_UPDATE",
        storyPlan: {
          titleOptions: ["Production artifact engine"],
          hook: "Storro can now generate grounded markdown.",
          audience: "builders",
          thesis: "Approved facts can become a polished update.",
          sections: [{ heading: "What shipped", purpose: "Show implementation", factIds: [publicFactId] }],
          factsToUse: [publicFactId],
          claimsToAvoid: ["Do not claim production deployment."],
          nextStep: "Run grounding review.",
          templateConstraints: ["Keep it concise."],
        },
      },
    });
    await approveStoryPlan(context, {
      projectId,
      storyRunId: storyRun.id,
    });
    const job = await enqueueArtifactGeneration(context, {
      projectId,
      storyRunId: storyRun.id,
      promptVersion: "artifact-generation.test",
    });
    const requests: AiGatewayProviderRequest[] = [];
    const result = await executeArtifactGenerationJob(
      context,
      {
        projectId,
        jobId: job.id,
      },
      providerWithArtifact(
        {
          title: "Production artifact engine",
          contentMarkdown: "## What shipped\n\nStorro stores generated markdown with metadata.",
          usedFactIds: [publicFactId],
        },
        requests,
      ),
      modelPolicy,
    );

    const metadata = result.artifact.metadata as Record<string, unknown>;
    const promptPayload = requests[0].messages.find((message) => message.role === "user")?.content ?? "";
    const revision = await prisma.editorRevision.findFirstOrThrow({
      where: {
        artifactId: result.artifact.id,
      },
    });

    expect(result.job.status).toBe("COMPLETED");
    expect(result.artifact).toMatchObject({
      title: "Production artifact engine",
      status: "DRAFT",
      model: "gpt-test-generation",
      promptVersion: "artifact-generation.test",
      contentMarkdown: "## What shipped\n\nStorro stores generated markdown with metadata.",
    });
    expect(metadata).toMatchObject({
      model: "gpt-test-generation",
      promptVersion: "artifact-generation.test",
      templateId: "dorahacks-progress",
      inputFactIds: [publicFactId],
      usedFactIds: [publicFactId],
    });
    expect(revision.contentHash).toHaveLength(64);
    expect(promptPayload).toContain("The production artifact engine stores markdown with metadata.");
    expect(promptPayload).not.toContain("Private internal implementation note.");
  });

  it("blocks public template generation when a plan references private facts", async () => {
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId,
        extractionRunId,
        createdById: userId,
        status: "COMPLETED",
        templateId: "dorahacks-progress",
        format: "DORAHACKS_UPDATE",
        storyPlan: {
          titleOptions: ["Invalid public plan"],
          hook: "This should not generate.",
          audience: "public",
          thesis: "Private facts cannot support public templates.",
          sections: [{ heading: "Private", purpose: "Invalid", factIds: [privateFactId] }],
          factsToUse: [privateFactId],
          claimsToAvoid: [],
          nextStep: "Stop.",
          templateConstraints: [],
        },
      },
    });
    const job = await enqueueArtifactGeneration(context, {
      projectId,
      storyRunId: storyRun.id,
    });

    await expect(
      executeArtifactGenerationJob(
        context,
        {
          projectId,
          jobId: job.id,
        },
        providerWithArtifact(
          {
            title: "Invalid",
            contentMarkdown: "## Invalid",
            usedFactIds: [privateFactId],
          },
          [],
        ),
        modelPolicy,
      ),
    ).rejects.toThrow("Story plan references facts unavailable under template policy.");

    const failedJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: job.id,
      },
    });

    expect(failedJob.status).toBe("FAILED");
  });
});
