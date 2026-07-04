import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import { chunkNormalizedSource } from "@/services/source-chunking-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let sourceDocumentId = "";
let normalizedSourceId = "";
let context: ScopedContext;

describe("source chunk persistence", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `chunk-user-${suffix}`,
        email: `chunk-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Chunk Org ${suffix}`,
        slug: `chunk-org-${suffix}`,
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
      name: `Chunk Project ${suffix}`,
    });
    const source = await createSourceDocument(context, {
      projectId: project.id,
      title: "Long normalized source",
      body: "Long source",
      sourceType: "MANUAL_NOTE",
    });
    const normalized = await prisma.normalizedSource.create({
      data: {
        orgId,
        projectId: project.id,
        sourceDocumentId: source.id,
        sourceType: "MANUAL_NOTE",
        title: "Long normalized source",
        body: Array.from({ length: 12 }, (_, index) => `## Section ${index}\n${"context ".repeat(50)}`).join("\n\n"),
        rankingScore: 100,
      },
    });

    projectId = project.id;
    sourceDocumentId = source.id;
    normalizedSourceId = normalized.id;
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

  it("persists chunk summaries and token estimates", async () => {
    const chunks = await chunkNormalizedSource(
      context,
      {
        normalizedSourceId,
        projectId,
      },
      { maxTokens: 80 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => (chunk.tokenEstimate ?? 0) <= 80)).toBe(true);
    expect(chunks[0]?.summary).toContain("Section 0");

    const persistedCount = await prisma.normalizedSourceChunk.count({
      where: {
        normalizedSourceId,
      },
    });

    expect(persistedCount).toBe(chunks.length);
    expect(sourceDocumentId).toBeTruthy();
  });
});
