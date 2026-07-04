import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resolveLocalAuthContext } from "@/services/auth-context-service";
import { listProjects } from "@/services/project-service";
import { ensureDefaultOrganizationForUser } from "@/services/next-auth-sync-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const authUserId = `next-auth-user-${suffix}`;

let userId = "";
let orgAId = "";
let orgBId = "";

describe("NextAuth local sync service", () => {
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
        id: userId,
      },
    });

    await prisma.$disconnect();
  });

  it("creates a local user/default organization and supports organization-scoped context", async () => {
    const defaultContext = await ensureDefaultOrganizationForUser({
      authUserId,
      email: `next-auth-${suffix}@storro.local`,
      name: "NextAuth Builder",
      image: null,
    });

    userId = defaultContext.user.id;
    orgAId = defaultContext.orgId;

    const orgB = await prisma.organization.create({
      data: {
        name: "Second Workspace",
        slug: `second-workspace-${suffix}`,
        memberships: {
          create: {
            userId,
            role: "EDITOR",
          },
        },
      },
    });
    orgBId = orgB.id;

    await Promise.all([
      prisma.project.create({
        data: {
          orgId: orgAId,
          ownerId: userId,
          name: "Default Org Project",
          slug: `default-org-project-${suffix}`,
          tags: [],
        },
      }),
      prisma.project.create({
        data: {
          orgId: orgBId,
          ownerId: userId,
          name: "Second Org Project",
          slug: `second-org-project-${suffix}`,
          tags: [],
        },
      }),
    ]);

    const contextA = await resolveLocalAuthContext({ authUserId, orgId: orgAId });
    const contextB = await resolveLocalAuthContext({ authUserId, orgId: orgBId });

    expect(contextA.orgId).toBe(orgAId);
    expect(contextA.role).toBe("OWNER");
    expect(contextB.orgId).toBe(orgBId);
    expect(contextB.role).toBe("EDITOR");

    const [projectsA, projectsB] = await Promise.all([listProjects(contextA), listProjects(contextB)]);

    expect(projectsA.map((project) => project.name)).toEqual(["Default Org Project"]);
    expect(projectsB.map((project) => project.name)).toEqual(["Second Org Project"]);
  });
});
