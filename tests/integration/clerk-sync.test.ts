import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { resolveLocalAuthContext } from "@/server/auth-context";
import { listProjects } from "@/services/project-service";
import {
  syncClerkMembership,
  syncClerkOrganization,
  syncClerkUser,
} from "@/services/clerk-sync-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clerkUserId = `clerk-user-${suffix}`;
const clerkOrgAId = `clerk-org-a-${suffix}`;
const clerkOrgBId = `clerk-org-b-${suffix}`;

let userId = "";
let orgAId = "";
let orgBId = "";

describe("Clerk sync service", () => {
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

  it("syncs Clerk users, organizations, memberships, and organization-scoped context", async () => {
    const user = await syncClerkUser({
      id: clerkUserId,
      first_name: "Test",
      last_name: "Builder",
      primary_email_address_id: "email-primary",
      email_addresses: [{ id: "email-primary", email_address: `builder-${suffix}@storro.local` }],
    });
    userId = user.id;

    const [orgA, orgB] = await Promise.all([
      syncClerkOrganization({
        id: clerkOrgAId,
        name: "Clerk Org A",
        slug: `clerk-org-a-${suffix}`,
      }),
      syncClerkOrganization({
        id: clerkOrgBId,
        name: "Clerk Org B",
        slug: `clerk-org-b-${suffix}`,
      }),
    ]);
    orgAId = orgA.id;
    orgBId = orgB.id;

    await Promise.all([
      syncClerkMembership({
        role: "org:admin",
        public_user_data: { user_id: clerkUserId },
        organization: { id: clerkOrgAId },
      }),
      syncClerkMembership({
        role: "org:member",
        public_user_data: { user_id: clerkUserId },
        organization: { id: clerkOrgBId },
      }),
    ]);

    await Promise.all([
      prisma.project.create({
        data: {
          orgId: orgAId,
          ownerId: userId,
          name: "Org A Project",
          slug: `org-a-project-${suffix}`,
          tags: [],
        },
      }),
      prisma.project.create({
        data: {
          orgId: orgBId,
          ownerId: userId,
          name: "Org B Project",
          slug: `org-b-project-${suffix}`,
          tags: [],
        },
      }),
    ]);

    const contextA = await resolveLocalAuthContext({ clerkUserId, clerkOrgId: clerkOrgAId });
    const contextB = await resolveLocalAuthContext({ clerkUserId, clerkOrgId: clerkOrgBId });

    expect(contextA.orgId).toBe(orgAId);
    expect(contextA.role).toBe("ADMIN");
    expect(contextB.orgId).toBe(orgBId);
    expect(contextB.role).toBe("EDITOR");

    const [projectsA, projectsB] = await Promise.all([listProjects(contextA), listProjects(contextB)]);

    expect(projectsA.map((project) => project.name)).toEqual(["Org A Project"]);
    expect(projectsB.map((project) => project.name)).toEqual(["Org B Project"]);
  });
});
