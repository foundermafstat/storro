import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  archiveProject,
  createProject,
  extractProjectSettings,
  getProjectById,
  getProjectDashboardSummary,
  listArchivedProjects,
  listProjects,
  restoreProject,
  updateProject,
} from "@/services/project-service";
import { createManualSourceDocument } from "@/services/source-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgAId = "";
let orgBId = "";
let userAId = "";
let userBId = "";
let contextA: ScopedContext;
let contextB: ScopedContext;

describe("project workspace domain", () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          authUserId: `project-user-a-${suffix}`,
          email: `project-user-a-${suffix}@storro.local`,
        },
      }),
      prisma.user.create({
        data: {
          authUserId: `project-user-b-${suffix}`,
          email: `project-user-b-${suffix}@storro.local`,
        },
      }),
    ]);

    userAId = userA.id;
    userBId = userB.id;

    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `Project Org A ${suffix}`,
          slug: `project-org-a-${suffix}`,
        },
      }),
      prisma.organization.create({
        data: {
          name: `Project Org B ${suffix}`,
          slug: `project-org-b-${suffix}`,
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

  it("creates, edits, searches, archives, and restores an org-scoped project", async () => {
    const project = await createProject(contextA, {
      name: "Release Workspace",
      description: "Original description",
      tags: ["API", "Launch"],
      metadata: {
        repositoryUrl: "https://github.com/foundermafstat/storro",
      },
      settings: {
        visibility: "ORGANIZATION",
        aiReviewRequired: true,
      },
    });

    expect(project.slug).toBe("release-workspace");
    expect(extractProjectSettings(project.metadata).visibility).toBe("ORGANIZATION");

    const updated = await updateProject(contextA, project.id, {
      name: "Release Workspace Edited",
      description: "Updated description",
      tags: ["api", "reviewed"],
      settings: {
        sourcePrivacyDefault: false,
      },
    });

    expect(updated.name).toBe("Release Workspace Edited");
    expect(updated.tags).toEqual(["api", "reviewed"]);
    expect(extractProjectSettings(updated.metadata).sourcePrivacyDefault).toBe(false);

    const searchResults = await listProjects(contextA, {
      search: "edited",
      tags: ["reviewed"],
    });

    expect(searchResults.map((item) => item.id)).toContain(project.id);
    await expect(getProjectById(contextB, project.id)).resolves.toBeNull();

    await createManualSourceDocument(contextA, {
      projectId: project.id,
      title: "Release source",
      body: "A source document for project summary.",
    });
    await prisma.extractionRun.create({
      data: {
        orgId: orgAId,
        projectId: project.id,
        createdById: userAId,
        status: "QUEUED",
        selectedSourceIds: [],
      },
    });
    await prisma.sourceConnection.create({
      data: {
        orgId: orgAId,
        projectId: project.id,
        provider: "GITHUB",
        status: "CONNECTED",
      },
    });
    await prisma.job.create({
      data: {
        orgId: orgAId,
        projectId: project.id,
        type: "EXTRACTION",
        status: "RUNNING",
        queueName: "default",
        payload: {},
      },
    });
    await prisma.usageEvent.create({
      data: {
        orgId: orgAId,
        projectId: project.id,
        userId: userAId,
        type: "AI_EXTRACTION",
        quantity: 7,
      },
    });

    const summary = await getProjectDashboardSummary(contextA, project.id);

    expect(summary.cards).toMatchObject({
      sources: 1,
      extractions: 1,
      artifacts: 0,
      integrations: 1,
      recentJobs: 1,
      usage: 7,
    });
    expect(summary.recentJobs[0]?.status).toBe("RUNNING");

    await archiveProject(contextA, project.id);

    const activeProjects = await listProjects(contextA);
    expect(activeProjects.map((item) => item.id)).not.toContain(project.id);

    const archivedProjects = await listArchivedProjects(contextA);
    expect(archivedProjects.map((item) => item.id)).toContain(project.id);

    await restoreProject(contextA, project.id);

    const restoredProjects = await listProjects(contextA);
    expect(restoredProjects.map((item) => item.id)).toContain(project.id);
  });
});
