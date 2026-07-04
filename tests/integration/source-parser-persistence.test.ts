import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import { createSourceDocument } from "@/services/source-service";
import { parseAndPersistSourceDocument } from "@/services/source-parser-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("source parser persistence", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `parser-user-${suffix}`,
        email: `parser-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Parser Org ${suffix}`,
        slug: `parser-org-${suffix}`,
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
      name: `Parser Project ${suffix}`,
    });

    projectId = project.id;
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

  it("persists normalized parser output and visible warnings", async () => {
    const source = await createSourceDocument(context, {
      projectId,
      title: "Sensitive parser note",
      body: "# Context\nThis source mentions api_key before redaction.",
      sourceType: "MANUAL_NOTE",
      tags: ["parser"],
    });

    const result = await parseAndPersistSourceDocument(context, source.id);

    expect(result.normalizedSource.body).toContain("api_key");
    expect(result.warnings).toEqual(["Potential sensitive token language detected before redaction."]);

    const updatedSource = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: source.id,
      },
    });

    expect(updatedSource.status).toBe("PARSED");
    expect(updatedSource.metadata).toMatchObject({
      parser: {
        status: "parsed",
        warnings: ["Potential sensitive token language detected before redaction."],
      },
    });
  });

  it("records parser failure without creating normalized source output", async () => {
    const source = await createSourceDocument(context, {
      projectId,
      title: "archive.zip",
      rawObjectKey: `orgs/${orgId}/projects/${projectId}/sources/archive.zip`,
      sourceType: "FILE_UPLOAD",
      tags: ["archive"],
    });

    await expect(parseAndPersistSourceDocument(context, source.id)).rejects.toThrow("Unsupported source parser.");

    const normalizedCount = await prisma.normalizedSource.count({
      where: {
        sourceDocumentId: source.id,
      },
    });
    const updatedSource = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: source.id,
      },
    });

    expect(normalizedCount).toBe(0);
    expect(updatedSource.rawObjectKey).toBe(source.rawObjectKey);
    expect(updatedSource.status).toBe("FAILED");
    expect(updatedSource.metadata).toMatchObject({
      parser: {
        status: "failed",
        error: "Unsupported source parser.",
      },
    });
  });
});
