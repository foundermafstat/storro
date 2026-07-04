import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ScopedContext } from "@/services/scoped-context";

export async function recordAuditEvent(
  context: ScopedContext,
  input: {
    action: string;
    entityType: string;
    entityId?: string;
    projectId?: string;
    metadata?: Record<string, unknown>;
  },
  db: DatabaseClient = prisma,
) {
  return db.auditLog.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      userId: context.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
