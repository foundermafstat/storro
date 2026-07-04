import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  type AiGatewayProvider,
  createAiModelPolicy,
  type AiGatewayProviderRequest,
} from "@/services/ai-gateway";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import {
  generateStoryPlan,
  listStoryPlans,
} from "@/services/story-planning-service";

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
let rejectedFactId = "";
let context: ScopedContext;

function providerWithPlan(planFactory: () => unknown, requests: AiGatewayProviderRequest[]): AiGatewayProvider {
  return {
    async createResponse(request) {
      requests.push(request);

      return {
        id: `resp-${Date.now()}`,
        status: "completed",
        outputParsed: planFactory(),
        usage: {
          totalTokens: 11,
        },
      };
    },
  };
}

describe("story planning service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `story-plan-user-${suffix}`,
        email: `story-plan-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Story Plan Org ${suffix}`,
        slug: `story-plan-org-${suffix}`,
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
      name: `Story Plan Project ${suffix}`,
    });
    const run = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [],
        missingContext: ["No deployment proof yet."],
        riskFlags: [{ type: "coverage", severity: "medium", message: "Needs E2E coverage." }],
      },
    });
    const publicFact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "implementation",
        text: "Public approved fact for planning.",
        sourceIds: [],
        filePaths: [],
        confidence: 0.9,
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
        text: "Private approved fact for internal planning.",
        sourceIds: [],
        filePaths: [],
        confidence: 0.95,
        isPrivate: true,
        reviewStatus: "APPROVED",
      },
    });
    const rejectedFact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "risk",
        text: "Rejected fact must not be planned.",
        sourceIds: [],
        filePaths: [],
        confidence: 0.4,
        isPrivate: false,
        reviewStatus: "REJECTED",
      },
    });

    projectId = project.id;
    extractionRunId = run.id;
    publicFactId = publicFact.id;
    privateFactId = privateFact.id;
    rejectedFactId = rejectedFact.id;
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

  it("generates reviewable plan versions from approved public facts only", async () => {
    const requests: AiGatewayProviderRequest[] = [];
    const result = await generateStoryPlan(
      context,
      {
        projectId,
        templateId: "dorahacks-progress",
        format: "DORAHACKS_UPDATE",
        audience: "builders",
        tone: "technical",
        publicOnly: true,
      },
      providerWithPlan(
        () => ({
          titleOptions: ["Storro progress update"],
          hook: "Storro now has a grounded planning layer.",
          audience: "builders",
          thesis: "Approved evidence can become a structured update.",
          sections: [{ heading: "Implementation", purpose: "Show progress", factIds: [publicFactId] }],
          factsToUse: [publicFactId],
          claimsToAvoid: ["Do not claim production deployment."],
          nextStep: "Review the plan.",
          templateConstraints: ["Use concise sections."],
        }),
        requests,
      ),
      modelPolicy,
    );

    const promptPayload = requests[0].messages.find((message) => message.role === "user")?.content ?? "";

    expect(result.storyRun.status).toBe("NEEDS_REVIEW");
    expect(result.storyRun.extractionRunId).toBe(extractionRunId);
    expect(result.plan.factsToUse).toEqual([publicFactId]);
    expect(promptPayload).toContain("Public approved fact for planning.");
    expect(promptPayload).not.toContain("Private approved fact for internal planning.");
    expect(promptPayload).not.toContain("Rejected fact must not be planned.");
    expect(rejectedFactId).toBeTruthy();

    const regenerated = await generateStoryPlan(
      context,
      {
        projectId,
        templateId: "dorahacks-progress",
        format: "DORAHACKS_UPDATE",
        publicOnly: true,
        promptVersion: "story-plan.test-regenerate",
      },
      providerWithPlan(
        () => ({
          titleOptions: ["Regenerated update"],
          hook: "A second plan keeps version history.",
          audience: "builders",
          thesis: "Regeneration creates a new run.",
          sections: [{ heading: "Evidence", purpose: "Reuse approved fact", factIds: [publicFactId] }],
          factsToUse: [publicFactId],
          claimsToAvoid: ["Do not cite rejected or private facts."],
          nextStep: "Compare versions.",
          templateConstraints: [],
        }),
        requests,
      ),
      modelPolicy,
    );

    const plans = await listStoryPlans(context, { projectId });

    expect(regenerated.storyRun.id).not.toBe(result.storyRun.id);
    expect(plans.map((plan) => plan.id)).toEqual(expect.arrayContaining([result.storyRun.id, regenerated.storyRun.id]));
  });

  it("includes approved private facts only for non-public plans", async () => {
    const requests: AiGatewayProviderRequest[] = [];

    await generateStoryPlan(
      context,
      {
        projectId,
        templateId: "internal-changelog",
        format: "INTERNAL_CHANGELOG",
        publicOnly: false,
      },
      providerWithPlan(
        () => ({
          titleOptions: ["Internal update"],
          hook: "Internal planning includes private approved context.",
          audience: "team",
          thesis: "Private approved facts can support internal artifacts.",
          sections: [{ heading: "Internal", purpose: "Use private fact", factIds: [privateFactId] }],
          factsToUse: [privateFactId],
          claimsToAvoid: ["Do not publish private implementation details."],
          nextStep: "Review internally.",
          templateConstraints: [],
        }),
        requests,
      ),
      modelPolicy,
    );

    const promptPayload = requests[0].messages.find((message) => message.role === "user")?.content ?? "";

    expect(promptPayload).toContain("Public approved fact for planning.");
    expect(promptPayload).toContain("Private approved fact for internal planning.");
  });

  it("rejects plans that reference facts outside the approved generation set", async () => {
    await expect(
      generateStoryPlan(
        context,
        {
          projectId,
          templateId: "dorahacks-progress",
          format: "DORAHACKS_UPDATE",
          publicOnly: true,
        },
        providerWithPlan(
          () => ({
            titleOptions: ["Invalid plan"],
            hook: "This should fail.",
            audience: "public",
            thesis: "Rejected facts are not allowed.",
            sections: [{ heading: "Bad", purpose: "Reference rejected fact", factIds: [rejectedFactId] }],
            factsToUse: [rejectedFactId],
            claimsToAvoid: [],
            nextStep: "Stop.",
            templateConstraints: [],
          }),
          [],
        ),
        modelPolicy,
      ),
    ).rejects.toThrow("Story plan referenced facts that are not approved for generation.");
  });
});
