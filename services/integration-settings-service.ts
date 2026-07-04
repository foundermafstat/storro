import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertIntegrationManagement, assertOrgPermission } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { disconnectGitHubInstallation } from "@/services/github-app-service";
import { NotFoundError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export async function getIntegrationSettings(
  context: ScopedContext,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "integration.manage", db);

  const [githubInstallations, sourceConnections, integrationAccounts, latestWebhook, recentAudit, projects, usageEvents] = await Promise.all([
    db.githubInstallation.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" } }),
    db.sourceConnection.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" } }),
    db.integrationAccount.findMany({ where: { orgId: context.orgId }, orderBy: { updatedAt: "desc" } }),
    db.webhookDelivery.findFirst({ where: { provider: "GITHUB", orgId: context.orgId }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { orgId: context.orgId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.project.findMany({ where: { orgId: context.orgId }, select: { id: true, name: true, slug: true } }),
    db.usageEvent.groupBy({
      by: ["type"],
      where: {
        orgId: context.orgId,
        type: {
          in: ["AI_EXTRACTION", "AI_GENERATION", "STORAGE_BYTES"],
        },
      },
      _sum: {
        quantity: true,
      },
      _count: {
        _all: true,
      },
    }),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return {
    github: githubInstallations.map((installation) => ({
      id: installation.id,
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      status: installation.status,
      permissions: installation.permissions,
      lastSyncedAt: installation.lastSyncedAt?.toISOString() ?? null,
      connections: sourceConnections
        .filter((connection) => connection.provider === "GITHUB" && connection.externalId?.startsWith(`${installation.installationId}:`))
        .map((connection) => formatConnectionHealth(connection, projectsById)),
    })),
    chatgpt: integrationAccounts.filter((account) => account.provider === "CHATGPT").map(formatIntegrationAccount),
    codexAction: sourceConnections.filter((connection) => connection.provider === "CODEX").map((connection) => formatConnectionHealth(connection, projectsById)),
    cli: sourceConnections.filter((connection) => connection.provider === "CLI").map((connection) => formatConnectionHealth(connection, projectsById)),
    openai: integrationAccounts.filter((account) => account.provider === "OPENAI").map(formatIntegrationAccount),
    objectStorage: integrationAccounts.filter((account) => account.provider === "OBJECT_STORAGE").map(formatIntegrationAccount),
    openaiUsage: formatUsageEvents(usageEvents),
    webhooks: latestWebhook
      ? {
          id: latestWebhook.id,
          eventType: latestWebhook.eventType,
          status: latestWebhook.status,
          signatureValid: latestWebhook.signatureValid,
          error: latestWebhook.error,
          processedAt: latestWebhook.processedAt?.toISOString() ?? null,
          createdAt: latestWebhook.createdAt.toISOString(),
        }
      : null,
    audit: recentAudit.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      projectId: entry.projectId,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

export async function enqueueGitHubResync(
  context: ScopedContext,
  input: {
    connectionId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);
  const connection = await db.sourceConnection.findFirst({
    where: {
      id: input.connectionId,
      orgId: context.orgId,
      provider: "GITHUB",
    },
  });

  if (!connection) {
    throw new NotFoundError("GitHub connection not found.");
  }

  const job = await db.job.create({
    data: {
      orgId: context.orgId,
      projectId: connection.projectId,
      type: "GITHUB_SYNC",
      status: "QUEUED",
      queueName: "github-sync",
      payload: {
        connectionId: connection.id,
        externalId: connection.externalId,
      },
    },
  });

  await db.sourceConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      status: "CONNECTED",
      metadata: {
        ...(isRecord(connection.metadata) ? connection.metadata : {}),
        lastSyncRequestedAt: new Date().toISOString(),
      } as Prisma.InputJsonObject,
    },
  });
  await recordAuditEvent(
    context,
    {
      action: "github.connection.resync_requested",
      entityType: "SourceConnection",
      entityId: connection.id,
      projectId: connection.projectId ?? undefined,
      metadata: {
        jobId: job.id,
        externalId: connection.externalId,
      },
    },
    db,
  );

  return job;
}

export async function disconnectGitHubFromSettings(
  context: ScopedContext,
  input: {
    installationId: string;
  },
  db: DatabaseClient = prisma,
) {
  return disconnectGitHubInstallation(context, input, db);
}

function formatConnectionHealth(connection: {
  id: string;
  projectId: string | null;
  status: string;
  displayName: string | null;
  externalId: string | null;
  lastSyncedAt: Date | null;
  metadata: Prisma.JsonValue;
}, projectsById: Map<string, { id: string; name: string; slug: string }>) {
  const lastError = isRecord(connection.metadata) && isRecord(connection.metadata.lastError)
    ? connection.metadata.lastError
    : undefined;
  const project = connection.projectId ? projectsById.get(connection.projectId) : undefined;

  return {
    id: connection.id,
    projectId: connection.projectId,
    projectName: project?.name ?? null,
    projectSlug: project?.slug ?? null,
    status: connection.status,
    displayName: connection.displayName,
    externalId: connection.externalId,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastError,
    actionableCopy: lastError ? "Review permissions, reconnect the integration, or retry sync." : undefined,
  };
}

function formatIntegrationAccount(account: {
  id: string;
  status: string;
  displayName: string | null;
  externalId: string | null;
  metadata: Prisma.JsonValue;
  lastSyncedAt: Date | null;
}) {
  return {
    id: account.id,
    status: account.status,
    displayName: account.displayName,
    externalId: account.externalId,
    metadata: account.metadata,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
  };
}

function formatUsageEvents(events: Array<{ type: string; _sum: { quantity: number | null }; _count: { _all: number } }>) {
  return Object.fromEntries(
    events.map((event) => [
      event.type,
      {
        quantity: event._sum.quantity ?? 0,
        events: event._count._all,
      },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
