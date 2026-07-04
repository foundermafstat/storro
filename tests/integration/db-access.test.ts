import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { runInTransaction } from "@/db/transaction";
import { createProject, getProjectById } from "@/services/project-service";
import { createManualSourceDocument } from "@/services/source-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgAId = "";
let orgBId = "";
let userAId = "";
let userBId = "";
let projectAId = "";
let contextA: ScopedContext;
let contextB: ScopedContext;

describe("database access layer", () => {
  beforeAll(async () => {
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          clerkUserId: `test-user-a-${suffix}`,
          email: `test-user-a-${suffix}@storro.local`,
        },
      }),
      prisma.user.create({
        data: {
          clerkUserId: `test-user-b-${suffix}`,
          email: `test-user-b-${suffix}@storro.local`,
        },
      }),
    ]);

    userAId = userA.id;
    userBId = userB.id;

    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `Test Org A ${suffix}`,
          slug: `test-org-a-${suffix}`,
        },
      }),
      prisma.organization.create({
        data: {
          name: `Test Org B ${suffix}`,
          slug: `test-org-b-${suffix}`,
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
      name: "Scoped Project",
      slug: `scoped-project-${suffix}`,
      description: "Created through scoped service.",
      tags: ["integration"],
    });

    projectAId = project.id;
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

  it("returns no project across organization boundaries", async () => {
    const project = await getProjectById(contextB, projectAId);

    expect(project).toBeNull();
  });

  it("rolls back source creation inside a failed transaction", async () => {
    const title = `Rollback Source ${suffix}`;

    await expect(
      runInTransaction(async (tx) => {
        await createManualSourceDocument(
          contextA,
          {
            projectId: projectAId,
            title,
            body: "This source should roll back.",
          },
          tx,
        );

        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const sourceCount = await prisma.sourceDocument.count({
      where: {
        orgId: orgAId,
        projectId: projectAId,
        title,
      },
    });

    expect(sourceCount).toBe(0);
  });
});
