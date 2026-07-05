import { access } from "fs/promises";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createApiRoute } from "@/server/api/route-handler";
import {
  getJobTrace,
  getMetricsDashboard,
  resetObservabilityMetrics,
  setGlobalErrorReporter,
} from "@/services/observability-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let context: ScopedContext;

function createRequest(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://storro.test${path}`, init);
}

describe("observability service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `observe-user-${suffix}`, email: `observe-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Observe Org ${suffix}`, slug: `observe-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });

  afterAll(async () => {
    resetObservabilityMetrics();
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("reports API errors to Sentry-compatible reporter with request id", async () => {
    resetObservabilityMetrics();
    const captured: Array<{ requestId: string; path: string }> = [];
    setGlobalErrorReporter({
      captureException(_error, errorContext) {
        captured.push({ requestId: errorContext.requestId, path: errorContext.path });
      },
    });
    const route = createApiRoute({
      handler: () => {
        throw new Error("boom");
      },
    });

    const response = await route(createRequest("/api/observe", { headers: { "x-request-id": "req_observe" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(response.status).toBe(500);
    expect(captured).toEqual([{ requestId: "req_observe", path: "/api/observe" }]);
  });

  it("records job queue wait and processing duration", async () => {
    const createdAt = new Date(Date.now() - 10_000);
    const lockedAt = new Date(createdAt.getTime() + 2_000);
    const job = await prisma.job.create({
      data: {
        orgId,
        type: "EXTRACTION",
        status: "COMPLETED",
        queueName: "extraction",
        payload: {},
        attempts: 1,
        createdAt,
        lockedAt,
      },
    });
    const trace = await getJobTrace(context, { jobId: job.id });

    expect(trace.queueWaitMs).toBe(2_000);
    expect(trace.processingDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("builds metrics dashboard for API errors, queue depth, webhooks, GitHub sync, and AI usage", async () => {
    resetObservabilityMetrics();
    const route = createApiRoute({
      handler: () => {
        throw new Error("metrics boom");
      },
    });
    await route(createRequest("/api/metrics-boom"));
    await prisma.job.create({
      data: {
        orgId,
        type: "GITHUB_SYNC",
        status: "QUEUED",
        queueName: "github-sync",
        payload: {},
      },
    });
    await prisma.webhookDelivery.create({
      data: {
        orgId,
        provider: "GITHUB",
        deliveryId: `observe-${suffix}`,
        eventType: "push",
        status: "FAILED",
        signatureValid: true,
        payload: {},
      },
    });
    await prisma.usageEvent.create({ data: { orgId, userId, type: "AI_GENERATION", quantity: 11 } });
    const dashboard = await getMetricsDashboard(context);

    expect(dashboard.api.errors).toBeGreaterThanOrEqual(1);
    expect(dashboard.queueDepth.QUEUED).toBeGreaterThanOrEqual(1);
    expect(dashboard.githubSync.QUEUED).toBeGreaterThanOrEqual(1);
    expect(dashboard.webhooks.some((row) => row.provider === "GITHUB" && row.status === "FAILED")).toBe(true);
    expect(dashboard.aiUsage.AI_GENERATION).toBeGreaterThanOrEqual(11);
  });

  it("ships critical incident runbooks", async () => {
    await expect(access("docs/runbooks/ai-failures.md")).resolves.toBeUndefined();
    await expect(access("docs/runbooks/github-webhook-failures.md")).resolves.toBeUndefined();
    await expect(access("docs/runbooks/queue-backlog.md")).resolves.toBeUndefined();
    await expect(access("docs/runbooks/database-issues.md")).resolves.toBeUndefined();
    await expect(access("docs/runbooks/billing-webhook-failures.md")).resolves.toBeUndefined();
  });
});
