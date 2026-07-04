import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import {
  createManualSourceDocument,
  createSourceDocument,
  getSourceDocumentById,
  listSourceDocuments,
  selectSourceDocumentsForExtraction,
  softDeleteSourceDocument,
  updateSourceDocument,
} from "@/services/source-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgAId = "";
let orgBId = "";
let userAId = "";
let userBId = "";
let projectId = "";
let contextA: ScopedContext;
let contextB: ScopedContext;

describe("source document CRUD", () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          authUserId: `source-user-a-${suffix}`,
          email: `source-user-a-${suffix}@storro.local`,
        },
      }),
      prisma.user.create({
        data: {
          authUserId: `source-user-b-${suffix}`,
          email: `source-user-b-${suffix}@storro.local`,
        },
      }),
    ]);

    userAId = userA.id;
    userBId = userB.id;

    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `Source Org A ${suffix}`,
          slug: `source-org-a-${suffix}`,
        },
      }),
      prisma.organization.create({
        data: {
          name: `Source Org B ${suffix}`,
          slug: `source-org-b-${suffix}`,
        },
      }),
    ]);

    orgAId = orgA.id;
    orgBId = orgB.id;

    await Promise.all([
      prisma.membership.create({
        data: {
          orgId: orgAId,
          userId: userAId,
          role: "OWNER",
        },
      }),
      prisma.membership.create({
        data: {
          orgId: orgBId,
          userId: userBId,
          role: "OWNER",
        },
      }),
    ]);

    contextA = { orgId: orgAId, userId: userAId };
    contextB = { orgId: orgBId, userId: userBId };

    const project = await createProject(contextA, {
      name: `Source Project ${suffix}`,
      tags: ["sources"],
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [orgAId, orgBId].filter(Boolean),
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [userAId, userBId].filter(Boolean),
        },
      },
    });

    await prisma.$disconnect();
  });

  it("adds, views, filters, updates, deletes, and selects source documents safely", async () => {
    const manual = await createManualSourceDocument(contextA, {
      projectId,
      title: "Manual launch note",
      body: "Manual context for launch planning.",
      isPrivate: true,
      tags: ["Launch", "Spec"],
      metadata: {
        section: "planning",
      },
    });

    const github = await createSourceDocument(contextA, {
      projectId,
      title: "GitHub PR 42",
      body: "Merged API route changes.",
      tags: ["api", "github"],
      provenance: {
        kind: "github",
        externalId: "pull/42",
        externalUrl: "https://github.com/foundermafstat/storro/pull/42",
        actor: "foundermafstat",
      },
    });

    const fileUpload = await createSourceDocument(contextA, {
      projectId,
      title: "Uploaded release notes",
      rawObjectKey: `sources/${suffix}/release-notes.md`,
      tags: ["file", "release"],
      provenance: {
        kind: "file_upload",
        externalId: "release-notes.md",
      },
    });

    expect(github.sourceType).toBe("GITHUB_COMMIT");
    expect(fileUpload.sourceType).toBe("FILE_UPLOAD");
    expect(fileUpload.metadata).toMatchObject({
      provenance: {
        kind: "file_upload",
        externalId: "release-notes.md",
      },
    });

    const privateSources = await listSourceDocuments(contextA, {
      projectId,
      isPrivate: true,
      tags: ["spec"],
    });

    expect(privateSources.map((source) => source.id)).toEqual([manual.id]);

    const githubSources = await listSourceDocuments(contextA, {
      projectId,
      sourceType: "GITHUB_COMMIT",
      search: "PR",
      createdFrom: new Date(Date.now() - 60_000),
      createdTo: new Date(Date.now() + 60_000),
    });

    expect(githubSources.map((source) => source.id)).toEqual([github.id]);

    const updated = await updateSourceDocument(contextA, manual.id, {
      title: "Manual launch note edited",
      metadata: {
        reviewStatus: "approved",
      },
      tags: ["launch", "approved"],
      isPrivate: false,
    });

    expect(updated.title).toBe("Manual launch note edited");
    expect(updated.tags).toEqual(["launch", "approved"]);
    expect(updated.metadata).toMatchObject({
      section: "planning",
      reviewStatus: "approved",
      provenance: {
        kind: "manual_input",
      },
    });

    const detail = await getSourceDocumentById(contextA, manual.id);
    expect(detail?.id).toBe(manual.id);
    await expect(getSourceDocumentById(contextB, manual.id)).rejects.toThrow("Source document not found.");

    await softDeleteSourceDocument(contextA, manual.id);

    const visibleSources = await listSourceDocuments(contextA, { projectId });
    expect(visibleSources.map((source) => source.id)).not.toContain(manual.id);

    const allSources = await listSourceDocuments(contextA, {
      projectId,
      includeDeleted: true,
    });
    expect(allSources.map((source) => source.id)).toContain(manual.id);

    const extractionSources = await selectSourceDocumentsForExtraction(contextA, {
      projectId,
      sourceIds: [manual.id, github.id, fileUpload.id],
    });

    expect(extractionSources.map((source) => source.id)).toEqual([github.id, fileUpload.id]);
  });
});
