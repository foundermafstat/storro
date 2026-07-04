import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  addMissingExtractionFact,
  getApprovedFactsForGeneration,
  getFactSourceContext,
  listExtractionFacts,
  updateExtractionFactReview,
} from "@/services/extraction-review-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let sourceDocumentId = "";
let extractionRunId = "";
let factId = "";
let context: ScopedContext;

describe("extraction review service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `review-user-${suffix}`,
        email: `review-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Review Org ${suffix}`,
        slug: `review-org-${suffix}`,
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
      name: `Review Project ${suffix}`,
    });
    const source = await createSourceDocument(context, {
      projectId: project.id,
      title: "Review source",
      body: "Original source context",
      sourceType: "MANUAL_NOTE",
    });
    const run = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [source.id],
      },
    });
    const fact = await prisma.extractionFact.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: run.id,
        category: "implementation",
        text: "Initial fact",
        sourceIds: [source.id],
        filePaths: [],
        confidence: 0.7,
        isPrivate: false,
      },
    });

    projectId = project.id;
    sourceDocumentId = source.id;
    extractionRunId = run.id;
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

  it("approves, edits, rejects, marks private, adds facts, and filters generation facts", async () => {
    const approved = await updateExtractionFactReview(
      context,
      { factId, projectId },
      {
        text: "Edited approved fact",
        reviewStatus: "APPROVED",
        confidence: 0.95,
        isPrivate: true,
      },
    );

    expect(approved).toMatchObject({
      text: "Edited approved fact",
      reviewStatus: "APPROVED",
      confidence: 0.95,
      isPrivate: true,
    });

    const missing = await addMissingExtractionFact(context, {
      projectId,
      extractionRunId,
      category: "missing",
      text: "Added missing public fact",
      sourceIds: [sourceDocumentId],
      confidence: 1,
      isPrivate: false,
    });
    await updateExtractionFactReview(context, { factId: missing.id, projectId }, { reviewStatus: "REJECTED" });

    const privateApprovedFacts = await getApprovedFactsForGeneration(context, {
      projectId,
      publicOnly: false,
    });
    const publicApprovedFacts = await getApprovedFactsForGeneration(context, {
      projectId,
      publicOnly: true,
    });

    expect(privateApprovedFacts.map((fact) => fact.id)).toContain(factId);
    expect(publicApprovedFacts.map((fact) => fact.id)).not.toContain(factId);
    expect(publicApprovedFacts.map((fact) => fact.id)).not.toContain(missing.id);

    const filtered = await listExtractionFacts(context, {
      projectId,
      reviewStatus: "APPROVED",
      sourceId: sourceDocumentId,
      minConfidence: 0.9,
    });

    expect(filtered.map((fact) => fact.id)).toEqual([factId]);

    const sourceContext = await getFactSourceContext(context, { factId, projectId }, sourceDocumentId);
    expect(sourceContext.source.rawText).toBe("Original source context");
  });
});
