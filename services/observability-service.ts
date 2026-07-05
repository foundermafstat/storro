import { randomUUID } from "crypto";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertAdminAccess } from "@/services/authorization-service";
import { NotFoundError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type ObservedApiMetric = {
  level: "info" | "warn" | "error";
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorCode?: string;
  errorName?: string;
  createdAt: number;
};

type ErrorContext = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
};

export type ErrorReporter = {
  captureException(error: unknown, context: ErrorContext): void | Promise<void>;
};

const apiMetrics: ObservedApiMetric[] = [];
let globalErrorReporter: ErrorReporter | undefined;

export function setGlobalErrorReporter(reporter: ErrorReporter | undefined) {
  globalErrorReporter = reporter;
}

export function recordApiMetric(entry: Omit<ObservedApiMetric, "createdAt">) {
  apiMetrics.push({
    ...entry,
    createdAt: Date.now(),
  });

  if (apiMetrics.length > 2_000) {
    apiMetrics.splice(0, apiMetrics.length - 2_000);
  }
}

export async function reportErrorToSentry(error: unknown, context: ErrorContext) {
  const reporter = globalErrorReporter ?? createSentryReporter(process.env.SENTRY_DSN);

  if (!reporter) {
    return;
  }

  await reporter.captureException(error, context);
}

export function createSentryReporter(dsn: string | undefined): ErrorReporter | undefined {
  if (!dsn) {
    return undefined;
  }

  return {
    async captureException(error, context) {
      const parsed = new URL(dsn);
      const publicKey = parsed.username;
      const projectId = parsed.pathname.replace(/^\//, "");
      const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`;
      const eventId = randomUUID().replace(/-/g, "");
      const errorObject = error instanceof Error ? error : new Error(String(error));

      await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sentry-auth": `Sentry sentry_version=7,sentry_client=storro/0.1,sentry_key=${publicKey}`,
        },
        body: JSON.stringify({
          event_id: eventId,
          timestamp: new Date().toISOString(),
          platform: "javascript",
          level: "error",
          logger: "storro.api",
          tags: {
            requestId: context.requestId,
            method: context.method,
            path: context.path,
            statusCode: String(context.statusCode),
          },
          exception: {
            values: [
              {
                type: errorObject.name,
                value: errorObject.message,
              },
            ],
          },
        }),
      });
    },
  };
}

export async function getJobTrace(
  context: ScopedContext,
  input: {
    jobId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertAdminAccess(context, db);

  const job = await db.job.findFirst({
    where: {
      id: input.jobId,
      orgId: context.orgId,
    },
  });

  if (!job) {
    throw new NotFoundError("Job not found.");
  }

  const queueWaitMs = job.lockedAt ? job.lockedAt.getTime() - job.createdAt.getTime() : null;
  const processingDurationMs = job.lockedAt && ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)
    ? job.updatedAt.getTime() - job.lockedAt.getTime()
    : null;

  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    queueName: job.queueName,
    queueWaitMs,
    processingDurationMs,
    createdAt: job.createdAt.toISOString(),
    lockedAt: job.lockedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
    error: job.error,
  };
}

export async function getMetricsDashboard(
  context: ScopedContext,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertAdminAccess(context, db);

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [queueDepth, githubSyncMetrics, webhookMetrics, aiUsage] = await Promise.all([
    db.job.groupBy({
      by: ["status"],
      where: {
        orgId: context.orgId,
      },
      _count: {
        _all: true,
      },
    }),
    db.job.groupBy({
      by: ["status"],
      where: {
        orgId: context.orgId,
        type: "GITHUB_SYNC",
      },
      _count: {
        _all: true,
      },
    }),
    db.webhookDelivery.groupBy({
      by: ["provider", "status"],
      where: {
        orgId: context.orgId,
      },
      _count: {
        _all: true,
      },
    }),
    db.usageEvent.groupBy({
      by: ["type"],
      where: {
        orgId: context.orgId,
        type: { in: ["AI_EXTRACTION", "AI_GENERATION"] },
        createdAt: { gte: monthStart },
      },
      _sum: {
        quantity: true,
      },
    }),
  ]);

  return {
    api: summarizeApiMetrics(),
    queueDepth: Object.fromEntries(queueDepth.map((row) => [row.status, row._count._all])),
    githubSync: Object.fromEntries(githubSyncMetrics.map((row) => [row.status, row._count._all])),
    webhooks: webhookMetrics.map((row) => ({
      provider: row.provider,
      status: row.status,
      count: row._count._all,
    })),
    aiUsage: Object.fromEntries(aiUsage.map((row) => [row.type, row._sum.quantity ?? 0])),
    alertThresholds: {
      apiErrorRatePercent: 5,
      queueBacklogJobs: 100,
      webhookFailureCount: 10,
      aiFailureCount: 5,
      billingWebhookFailureCount: 1,
    },
  };
}

export function resetObservabilityMetrics() {
  apiMetrics.length = 0;
  globalErrorReporter = undefined;
}

function summarizeApiMetrics() {
  const total = apiMetrics.length;
  const errors = apiMetrics.filter((entry) => entry.statusCode >= 500).length;
  const warnings = apiMetrics.filter((entry) => entry.statusCode >= 400 && entry.statusCode < 500).length;
  const averageDurationMs = total
    ? Math.round(apiMetrics.reduce((sum, entry) => sum + entry.durationMs, 0) / total)
    : 0;

  return {
    total,
    errors,
    warnings,
    errorRatePercent: total ? Math.round((errors / total) * 10000) / 100 : 0,
    averageDurationMs,
    recent: apiMetrics.slice(-25),
  };
}
