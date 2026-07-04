import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  assertArtifactExportReady,
  enqueueGroundingReview,
  executeGroundingReviewJob,
} from "@/services/grounding-review-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fakeOpenAiKey = `sk-proj-${"a".repeat(24)}`;

let orgId = "";
let userId = "";
let projectId = "";
let storyRunId = "";
let factId = "";
let context: ScopedContext;

describe("grounding review service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `grounding-user-${suffix}`,
        email: `grounding-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Grounding Org ${suffix}`,
        slug: `grounding-org-${suffix}`,
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
      name: `Grounding Project ${suffix}`,
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
    const fact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "implementation",
        text: "The artifact engine stores generated markdown with metadata.",
        sourceIds: [],
        filePaths: ["services/artifact-generation-service.ts"],
        confidence: 0.94,
        isPrivate: false,
        reviewStatus: "APPROVED",
      },
    });
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        createdById: userId,
        status: "COMPLETED",
        templateId: "dorahacks-progress",
        format: "DORAHACKS_UPDATE",
        storyPlan: {
          titleOptions: ["Artifact engine"],
          hook: "Storro can generate grounded markdown.",
          audience: "builders",
          thesis: "Approved facts become updates.",
          sections: [{ heading: "What shipped", purpose: "Show implementation", factIds: [fact.id] }],
          factsToUse: [fact.id],
          claimsToAvoid: ["Do not claim billing or production deployment."],
          nextStep: "Review grounding.",
          templateConstraints: [],
        },
      },
    });

    projectId = project.id;
    storyRunId = storyRun.id;
    factId = fact.id;
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

  it("detects unsupported claims and blocks export after severe review failure", async () => {
    const artifact = await createArtifact(
      "## What shipped\n\nThe artifact engine stores generated markdown with metadata.\n\n## Evidence\n\nStorro launched Stripe billing with 500 users.",
    );
    const job = await enqueueGroundingReview(context, {
      projectId,
      artifactId: artifact.id,
    });
    const result = await executeGroundingReviewJob(context, {
      projectId,
      jobId: job.id,
    });

    expect(result.review.state).toBe("FAILED");
    expect(result.review.issues.map((issue) => issue.type)).toEqual(
      expect.arrayContaining(["unsupported_claim", "invented_metric", "invented_integration"]),
    );
    await expect(assertArtifactExportReady(context, { projectId, artifactId: artifact.id })).rejects.toThrow(
      "Artifact is not export-ready because grounding review failed or is incomplete.",
    );
  });

  it("blocks generated artifacts with leaked secrets", async () => {
    const artifact = await createArtifact(`## What shipped\n\nThe artifact engine stores generated markdown with metadata.\n${fakeOpenAiKey}`);
    const result = await executeGroundingReviewJob(
      context,
      {
        projectId,
        jobId: (await enqueueGroundingReview(context, { projectId, artifactId: artifact.id })).id,
      },
    );

    expect(result.review.state).toBe("FAILED");
    expect(result.review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "secret_leak",
          severity: "critical",
        }),
      ]),
    );
  });

  it("auto-revises generic phrases and records quality warnings", async () => {
    const artifact = await createArtifact(
      "## What shipped\n\nThe artifact engine stores generated markdown with metadata in a cutting-edge workflow.\n\n## Evidence\n\nThe artifact engine stores generated markdown with metadata.\n\n## What is next\n\nReview grounding.",
    );
    const result = await executeGroundingReviewJob(
      context,
      {
        projectId,
        jobId: (await enqueueGroundingReview(context, { projectId, artifactId: artifact.id })).id,
      },
    );

    expect(result.review.autoRevisions).toContain('Replaced generic phrase "cutting-edge".');
    expect(result.artifact.contentMarkdown).toContain("current workflow");
    expect(result.review.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "generic_phrase",
          severity: "low",
        }),
      ]),
    );
    expect(result.review.state).toBe("WARNINGS");
  });
});

async function createArtifact(contentMarkdown: string) {
  return prisma.storyArtifact.create({
    data: {
      orgId,
      projectId,
      storyRunId,
      format: "DORAHACKS_UPDATE",
      status: "DRAFT",
      title: "Grounding test artifact",
      contentMarkdown,
      metadata: {
        inputFactIds: [factId],
      },
    },
  });
}
