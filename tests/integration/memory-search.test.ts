import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { retrievePublicGenerationMemory, searchProjectMemory } from "@/services/memory-search-service";
import { createProject } from "@/services/project-service";
import { createSourceDocument } from "@/services/source-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgAId = "";
let orgBId = "";
let userAId = "";
let userBId = "";
let projectAId = "";
let projectBId = "";
let sourceId = "";
let artifactId = "";
let contextA: ScopedContext;
let contextB: ScopedContext;

describe("memory search service", () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { authUserId: `memory-user-a-${suffix}`, email: `memory-a-${suffix}@storro.local` } }),
      prisma.user.create({ data: { authUserId: `memory-user-b-${suffix}`, email: `memory-b-${suffix}@storro.local` } }),
    ]);
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: `Memory Org A ${suffix}`, slug: `memory-org-a-${suffix}` } }),
      prisma.organization.create({ data: { name: `Memory Org B ${suffix}`, slug: `memory-org-b-${suffix}` } }),
    ]);

    userAId = userA.id;
    userBId = userB.id;
    orgAId = orgA.id;
    orgBId = orgB.id;
    contextA = { orgId: orgAId, userId: userAId };
    contextB = { orgId: orgBId, userId: userBId };

    await Promise.all([
      prisma.membership.create({ data: { orgId: orgAId, userId: userAId, role: "OWNER" } }),
      prisma.membership.create({ data: { orgId: orgBId, userId: userBId, role: "OWNER" } }),
    ]);

    const [projectA, projectB] = await Promise.all([
      createProject(contextA, { name: `Memory Project A ${suffix}` }),
      createProject(contextB, { name: `Memory Project B ${suffix}` }),
    ]);
    projectAId = projectA.id;
    projectBId = projectB.id;

    const source = await createSourceDocument(contextA, {
      projectId: projectAId,
      title: "Aurelia launch evidence",
      body: "The Aurelia launch evidence mentions commercial onboarding and a public milestone.",
      sourceType: "MANUAL_NOTE",
      tags: ["launch", "evidence"],
    });
    sourceId = source.id;

    const normalized = await prisma.normalizedSource.create({
      data: {
        orgId: orgAId,
        projectId: projectAId,
        sourceDocumentId: sourceId,
        sourceType: "MANUAL_NOTE",
        title: "Normalized Aurelia source",
        body: "Normalized launch memory for the Aurelia milestone.",
        rankingScore: 0.8,
      },
    });
    await prisma.normalizedSourceChunk.create({
      data: {
        orgId: orgAId,
        projectId: projectAId,
        normalizedSourceId: normalized.id,
        chunkIndex: 0,
        body: "Chunked Aurelia launch memory.",
      },
    });
    const extractionRun = await prisma.extractionRun.create({
      data: {
        orgId: orgAId,
        projectId: projectAId,
        createdById: userAId,
        status: "COMPLETED",
        selectedSourceIds: [sourceId],
      },
    });
    await prisma.extractionFact.createMany({
      data: [
        {
          orgId: orgAId,
          projectId: projectAId,
          extractionRunId: extractionRun.id,
          category: "public",
          text: "Aurelia launch has approved public evidence.",
          sourceIds: [sourceId],
          filePaths: [],
          confidence: 0.82,
          isPrivate: false,
          reviewStatus: "APPROVED",
        },
        {
          orgId: orgAId,
          projectId: projectAId,
          extractionRunId: extractionRun.id,
          category: "private",
          text: "Private roadmap mentions a confidential Aurelia acquisition path.",
          sourceIds: [sourceId],
          filePaths: ["private.md"],
          confidence: 0.98,
          isPrivate: true,
          reviewStatus: "APPROVED",
        },
      ],
    });
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId: orgAId,
        projectId: projectAId,
        extractionRunId: extractionRun.id,
        createdById: userAId,
        status: "COMPLETED",
        templateId: "memory-test",
        format: "DORAHACKS_UPDATE",
        storyPlan: {
          titleOptions: ["Aurelia launch"],
          factsToUse: [],
          sections: [{ heading: "Launch", purpose: "Use memory search" }],
        },
      },
    });
    const artifact = await prisma.storyArtifact.create({
      data: {
        orgId: orgAId,
        projectId: projectAId,
        storyRunId: storyRun.id,
        format: "DORAHACKS_UPDATE",
        status: "DRAFT",
        title: "Aurelia launch announcement",
        contentMarkdown: "The Aurelia launch announcement uses approved public memory.",
      },
    });
    artifactId = artifact.id;

    await createSourceDocument(contextB, {
      projectId: projectBId,
      title: "Unrelated project note",
      body: "This organization has no Aurelia launch memory.",
      sourceType: "MANUAL_NOTE",
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("returns relevant scoped sources, story plans, and artifacts", async () => {
    const memory = await searchProjectMemory(contextA, {
      projectId: projectAId,
      query: "Aurelia launch",
      tags: ["launch"],
      sourceType: "MANUAL_NOTE",
    });
    const itemTypes = memory.results.map((result) => result.itemType);

    expect(itemTypes).toContain("source_document");
    expect(memory.results.every((result) => result.sourceType === "MANUAL_NOTE")).toBe(true);
    expect(memory.results.every((result) => result.tags.includes("launch"))).toBe(true);

    const allMemory = await searchProjectMemory(contextA, {
      projectId: projectAId,
      query: "Aurelia launch",
    });
    expect(allMemory.results.map((result) => result.itemType)).toEqual(expect.arrayContaining(["story_plan", "story_artifact"]));
  });

  it("does not leak cross-org memory", async () => {
    const otherOrgMemory = await searchProjectMemory(contextB, {
      projectId: projectBId,
      query: "confidential acquisition",
    });
    await expect(searchProjectMemory(contextB, { projectId: projectAId, query: "Aurelia launch" })).rejects.toThrow("Project not found.");
    expect(otherOrgMemory.results).toEqual([]);
  });

  it("filters private facts from public generation retrieval", async () => {
    const workspace = await searchProjectMemory(contextA, {
      projectId: projectAId,
      query: "confidential acquisition",
    });
    const publicGeneration = await retrievePublicGenerationMemory(contextA, {
      projectId: projectAId,
      query: "confidential acquisition",
    });

    expect(workspace.results.map((result) => result.itemType)).toContain("extraction_fact");
    expect(publicGeneration.results).toEqual([]);
  });

  it("reflects source and artifact changes without a stale index", async () => {
    await prisma.sourceDocument.update({
      where: { id: sourceId },
      data: { rawText: "Delta needle source update is now searchable." },
    });
    await prisma.storyArtifact.update({
      where: { id: artifactId },
      data: { contentMarkdown: "Release needle artifact update is now searchable." },
    });

    const sourceMemory = await searchProjectMemory(contextA, {
      projectId: projectAId,
      query: "delta needle",
    });
    const artifactMemory = await searchProjectMemory(contextA, {
      projectId: projectAId,
      query: "release needle",
    });

    expect(sourceMemory.results.map((result) => result.itemId)).toContain(sourceId);
    expect(artifactMemory.results.map((result) => result.itemId)).toContain(artifactId);
  });
});
