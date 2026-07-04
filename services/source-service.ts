import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertMembership } from "@/services/membership-service";
import { recordAuditEvent } from "@/services/audit-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export async function createManualSourceDocument(
  context: ScopedContext,
  input: {
    projectId: string;
    title: string;
    body: string;
    isPrivate?: boolean;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertMembership({ ...context, minimumRole: "EDITOR" }, db);

  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      orgId: context.orgId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new Error("Project not found in scoped organization.");
  }

  const source = await db.sourceDocument.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      createdById: context.userId,
      sourceType: "MANUAL_NOTE",
      status: "CREATED",
      title: input.title,
      rawText: input.body,
      isPrivate: input.isPrivate ?? false,
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "source.created",
      entityType: "sourceDocument",
      entityId: source.id,
      projectId: input.projectId,
    },
    db,
  );

  return source;
}
