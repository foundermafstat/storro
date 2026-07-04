import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  assertBillingManagement,
  assertIntegrationManagement,
  assertProjectPermission,
  canRole,
  protectedDomainActions,
} from "@/services/authorization-service";
import { AuthorizationError, NotFoundError } from "@/services/errors";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let otherOrgId = "";
let ownerId = "";
let editorId = "";
let viewerId = "";
let projectId = "";
let ownerContext: ScopedContext;
let editorContext: ScopedContext;
let viewerContext: ScopedContext;
let crossOrgContext: ScopedContext;

describe("authorization guards", () => {
  beforeAll(async () => {
    const [owner, editor, viewer] = await Promise.all([
      prisma.user.create({
        data: {
          authUserId: `auth-owner-${suffix}`,
          email: `auth-owner-${suffix}@storro.local`,
        },
      }),
      prisma.user.create({
        data: {
          authUserId: `auth-editor-${suffix}`,
          email: `auth-editor-${suffix}@storro.local`,
        },
      }),
      prisma.user.create({
        data: {
          authUserId: `auth-viewer-${suffix}`,
          email: `auth-viewer-${suffix}@storro.local`,
        },
      }),
    ]);

    ownerId = owner.id;
    editorId = editor.id;
    viewerId = viewer.id;

    const [org, otherOrg] = await Promise.all([
      prisma.organization.create({
        data: {
          name: `Auth Org ${suffix}`,
          slug: `auth-org-${suffix}`,
        },
      }),
      prisma.organization.create({
        data: {
          name: `Auth Other Org ${suffix}`,
          slug: `auth-other-org-${suffix}`,
        },
      }),
    ]);

    orgId = org.id;
    otherOrgId = otherOrg.id;

    await Promise.all([
      prisma.membership.create({ data: { orgId, userId: ownerId, role: "OWNER" } }),
      prisma.membership.create({ data: { orgId, userId: editorId, role: "EDITOR" } }),
      prisma.membership.create({ data: { orgId, userId: viewerId, role: "VIEWER" } }),
      prisma.membership.create({ data: { orgId: otherOrgId, userId: viewerId, role: "OWNER" } }),
    ]);

    ownerContext = { orgId, userId: ownerId };
    editorContext = { orgId, userId: editorId };
    viewerContext = { orgId, userId: viewerId };
    crossOrgContext = { orgId: otherOrgId, userId: viewerId };

    const project = await createProject(ownerContext, {
      name: "Authorization Project",
      slug: `authorization-project-${suffix}`,
      tags: ["authorization"],
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [orgId, otherOrgId].filter(Boolean),
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, editorId, viewerId].filter(Boolean),
        },
      },
    });

    await prisma.$disconnect();
  });

  it("prevents viewers from mutating project data", async () => {
    await expect(
      createProject(viewerContext, {
        name: "Viewer Project",
        slug: `viewer-project-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("prevents editors from managing billing and integrations", async () => {
    await expect(assertBillingManagement(editorContext)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(assertIntegrationManagement(editorContext)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("returns not found semantics for cross-organization resource access", async () => {
    await expect(assertProjectPermission(crossOrgContext, projectId, "project.read")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<NotFoundError>);
  });

  it("covers every protected domain action in the RBAC matrix", () => {
    expect(protectedDomainActions).toEqual([
      "project.read",
      "project.write",
      "project.archive",
      "source.read",
      "source.write",
      "extraction.read",
      "extraction.write",
      "artifact.read",
      "artifact.write",
      "integration.manage",
      "billing.manage",
      "admin.access",
    ]);

    expect(protectedDomainActions.every((action) => canRole("OWNER", action))).toBe(true);
    expect(canRole("VIEWER", "project.read")).toBe(true);
    expect(canRole("VIEWER", "project.write")).toBe(false);
    expect(canRole("EDITOR", "billing.manage")).toBe(false);
    expect(canRole("ADMIN", "integration.manage")).toBe(true);
    expect(canRole("ADMIN", "billing.manage")).toBe(false);
  });
});
