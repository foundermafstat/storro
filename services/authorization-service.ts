import type { MembershipRole } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { AuthorizationError, NotFoundError } from "@/services/errors";
import { getMembershipRole } from "@/services/membership-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type DomainAction =
  | "project.read"
  | "project.write"
  | "project.archive"
  | "source.read"
  | "source.write"
  | "extraction.read"
  | "extraction.write"
  | "artifact.read"
  | "artifact.write"
  | "integration.manage"
  | "billing.manage"
  | "admin.access";

const permissionsByRole: Record<MembershipRole, Set<DomainAction>> = {
  OWNER: new Set([
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
  ]),
  ADMIN: new Set([
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
    "admin.access",
  ]),
  EDITOR: new Set([
    "project.read",
    "project.write",
    "source.read",
    "source.write",
    "extraction.read",
    "extraction.write",
    "artifact.read",
    "artifact.write",
  ]),
  VIEWER: new Set(["project.read", "source.read", "extraction.read", "artifact.read"]),
};

export const protectedDomainActions: DomainAction[] = [
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
];

export function canRole(role: MembershipRole, action: DomainAction) {
  return permissionsByRole[role].has(action);
}

export async function assertOrgPermission(
  context: ScopedContext,
  action: DomainAction,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);

  const role = await getMembershipRole(context, db);

  if (!role) {
    throw new AuthorizationError("User does not belong to this organization.");
  }

  if (!canRole(role, action)) {
    throw new AuthorizationError("User does not have permission for this action.");
  }

  return role;
}

export async function assertProjectPermission(
  context: ScopedContext,
  projectId: string,
  action: DomainAction,
  db: DatabaseClient = prisma,
) {
  await assertOrgPermission(context, action, db);

  const project = await db.project.findFirst({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  return project;
}

export async function assertSourcePermission(
  context: ScopedContext,
  sourceDocumentId: string,
  action: DomainAction,
  db: DatabaseClient = prisma,
) {
  await assertOrgPermission(context, action, db);

  const source = await db.sourceDocument.findFirst({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
    },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (!source) {
    throw new NotFoundError("Source document not found.");
  }

  return source;
}

export async function assertIntegrationManagement(context: ScopedContext, db: DatabaseClient = prisma) {
  return assertOrgPermission(context, "integration.manage", db);
}

export async function assertBillingManagement(context: ScopedContext, db: DatabaseClient = prisma) {
  return assertOrgPermission(context, "billing.manage", db);
}

export async function assertAdminAccess(context: ScopedContext, db: DatabaseClient = prisma) {
  return assertOrgPermission(context, "admin.access", db);
}
