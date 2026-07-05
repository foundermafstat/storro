import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertAdminAccess } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type AdminConsoleInput = {
  userSearch?: string;
  organizationSearch?: string;
  includeRawSourceContent?: boolean;
  privilegedReason?: string;
  limit?: number;
};

export async function getAdminConsole(
  context: ScopedContext,
  input: AdminConsoleInput = {},
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertAdminAccess(context, db);

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const rawAccessGranted = Boolean(input.includeRawSourceContent && input.privilegedReason?.trim());

  await recordAuditEvent(
    context,
    {
      action: "admin.console.viewed",
      entityType: "AdminConsole",
      metadata: {
        userSearch: input.userSearch,
        organizationSearch: input.organizationSearch,
        rawAccessRequested: Boolean(input.includeRawSourceContent),
        rawAccessGranted,
      },
    },
    db,
  );

  const [organization, memberships, billingAccount, githubInstallations, sourceConnections, integrationAccounts, jobs, webhookDeliveries, auditLogs, usageEvents, sources] = await Promise.all([
    db.organization.findFirst({
      where: {
        id: context.orgId,
        ...(input.organizationSearch
          ? {
              OR: [
                { name: { contains: input.organizationSearch, mode: "insensitive" as const } },
                { slug: { contains: input.organizationSearch, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    }),
    db.membership.findMany({
      where: {
        orgId: context.orgId,
        ...(input.userSearch
          ? {
              user: {
                OR: [
                  { email: { contains: input.userSearch, mode: "insensitive" as const } },
                  { name: { contains: input.userSearch, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    }),
    db.billingAccount.findUnique({ where: { orgId: context.orgId } }),
    db.githubInstallation.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.sourceConnection.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.integrationAccount.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.job.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" }, take: limit }),
    db.webhookDelivery.findMany({ where: { orgId: context.orgId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.auditLog.findMany({ where: { orgId: context.orgId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.usageEvent.findMany({ where: { orgId: context.orgId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.sourceDocument.findMany({ where: { orgId: context.orgId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: limit }),
  ]);
  if (rawAccessGranted) {
    await recordAuditEvent(
      context,
      {
        action: "admin.raw_source_access",
        entityType: "SourceDocument",
        metadata: {
          reason: input.privilegedReason,
          sourceIds: sources.map((source) => source.id),
        },
      },
      db,
    );
  }

  return {
    organization,
    users: memberships.map((membership) => ({
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
    })),
    subscription: billingAccount
      ? {
          status: billingAccount.status,
          plan: billingAccount.plan,
          stripeCustomerId: billingAccount.stripeCustomerId,
          stripeSubscriptionId: billingAccount.stripeSubscriptionId,
          currentPeriodEnd: billingAccount.currentPeriodEnd?.toISOString() ?? null,
          trialEndsAt: billingAccount.trialEndsAt?.toISOString() ?? null,
          seatLimit: billingAccount.seatLimit,
          metadata: billingAccount.metadata,
        }
      : null,
    integrations: {
      githubInstallations,
      sourceConnections: sourceConnections.map((connection) => ({
        id: connection.id,
        projectId: connection.projectId,
        provider: connection.provider,
        status: connection.status,
        externalId: connection.externalId,
        displayName: connection.displayName,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        metadata: connection.metadata,
      })),
      integrationAccounts: integrationAccounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        status: account.status,
        externalId: account.externalId,
        displayName: account.displayName,
        lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
        metadata: account.metadata,
      })),
    },
    jobs: jobs.map((job) => ({
      id: job.id,
      projectId: job.projectId,
      type: job.type,
      status: job.status,
      queueName: job.queueName,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    })),
    webhookDeliveries: webhookDeliveries.map((delivery) => ({
      id: delivery.id,
      provider: delivery.provider,
      deliveryId: delivery.deliveryId,
      eventType: delivery.eventType,
      status: delivery.status,
      signatureValid: delivery.signatureValid,
      error: delivery.error,
      processedAt: delivery.processedAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
    })),
    auditLogs: auditLogs.map((entry) => ({
      id: entry.id,
      projectId: entry.projectId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
    usageEvents: usageEvents.map((event) => ({
      id: event.id,
      projectId: event.projectId,
      userId: event.userId,
      type: event.type,
      quantity: event.quantity,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
    sourceMetadata: sources.map((source) => ({
      id: source.id,
      projectId: source.projectId,
      sourceType: source.sourceType,
      status: source.status,
      title: source.title,
      tags: source.tags,
      isPrivate: source.isPrivate,
      rawContentHidden: !rawAccessGranted,
      rawTextPreview: rawAccessGranted ? (source.rawText ?? "").slice(0, 500) : undefined,
      rawObjectKey: source.rawObjectKey,
      metadata: source.metadata,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    })),
  };
}
