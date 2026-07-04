import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertMembership } from "@/services/membership-service";
import { recordAuditEvent } from "@/services/audit-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export async function listProjects(context: ScopedContext, db: DatabaseClient = prisma) {
  requireScopedContext(context);
  await assertMembership(context, db);

  return db.project.findMany({
    where: {
      orgId: context.orgId,
      archivedAt: null,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getProjectById(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertMembership(context, db);

  return db.project.findFirst({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
  });
}

export async function createProject(
  context: ScopedContext,
  input: {
    name: string;
    slug: string;
    description?: string;
    tags?: string[];
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertMembership({ ...context, minimumRole: "EDITOR" }, db);

  const project = await db.project.create({
    data: {
      orgId: context.orgId,
      ownerId: context.userId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      tags: input.tags ?? [],
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}

export async function archiveProject(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertMembership({ ...context, minimumRole: "ADMIN" }, db);

  const project = await db.project.update({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "project.archived",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}
