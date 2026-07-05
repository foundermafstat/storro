import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { getAdminConsole } from "@/services/admin-console-service";
import { AuthorizationError } from "@/services/errors";
import { createProject } from "@/services/project-service";
import { createSourceDocument } from "@/services/source-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let adminUserId = "";
let editorUserId = "";
let projectId = "";
let adminContext: ScopedContext;
let editorContext: ScopedContext;

describe("admin console service", () => {
  beforeAll(async () => {
    const [adminUser, editorUser] = await Promise.all([
      prisma.user.create({ data: { authUserId: `admin-console-owner-${suffix}`, email: `admin-console-owner-${suffix}@storro.local` } }),
      prisma.user.create({ data: { authUserId: `admin-console-editor-${suffix}`, email: `admin-console-editor-${suffix}@storro.local` } }),
    ]);
    const org = await prisma.organization.create({ data: { name: `Admin Console Org ${suffix}`, slug: `admin-console-org-${suffix}` } });
    orgId = org.id;
    adminUserId = adminUser.id;
    editorUserId = editorUser.id;
    adminContext = { orgId, userId: adminUserId };
    editorContext = { orgId, userId: editorUserId };
    await Promise.all([
      prisma.membership.create({ data: { orgId, userId: adminUserId, role: "OWNER" } }),
      prisma.membership.create({ data: { orgId, userId: editorUserId, role: "EDITOR" } }),
    ]);
    await prisma.billingAccount.create({ data: { orgId, plan: "team", status: "ACTIVE", seatLimit: 10 } });
    const project = await createProject(adminContext, { name: `Admin Project ${suffix}` });
    projectId = project.id;
    await createSourceDocument(adminContext, {
      projectId,
      title: "Sensitive source",
      body: "Raw sensitive source content should stay hidden by default.",
      sourceType: "MANUAL_NOTE",
      isPrivate: true,
      tags: ["support"],
    });
    await prisma.sourceConnection.create({
      data: {
        orgId,
        projectId,
        provider: "GITHUB",
        status: "ERROR",
        displayName: "foundermafstat/storro",
        externalId: "123:foundermafstat/storro",
        metadata: { lastError: { message: "permission denied" } },
      },
    });
    await prisma.job.create({
      data: {
        orgId,
        projectId,
        type: "GITHUB_SYNC",
        status: "FAILED",
        queueName: "github-sync",
        payload: {},
        error: "permission denied",
      },
    });
    await prisma.webhookDelivery.create({
      data: {
        orgId,
        provider: "GITHUB",
        deliveryId: `admin-console-${suffix}`,
        eventType: "push",
        status: "FAILED",
        signatureValid: true,
        error: "retry exhausted",
        payload: {},
      },
    });
    await prisma.usageEvent.create({ data: { orgId, projectId, userId: adminUserId, type: "AI_GENERATION", quantity: 3 } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, editorUserId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("blocks non-admin users from admin console access", async () => {
    await expect(getAdminConsole(editorContext)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets admin inspect job, integration, subscription, webhook, audit, and usage status safely", async () => {
    const consoleState = await getAdminConsole(adminContext);

    expect(consoleState.subscription).toMatchObject({ plan: "team", status: "ACTIVE" });
    expect(consoleState.jobs.some((job) => job.type === "GITHUB_SYNC" && job.status === "FAILED")).toBe(true);
    expect(consoleState.integrations.sourceConnections.some((connection) => connection.status === "ERROR")).toBe(true);
    expect(consoleState.webhookDeliveries.some((delivery) => delivery.status === "FAILED")).toBe(true);
    expect(consoleState.usageEvents.some((event) => event.type === "AI_GENERATION")).toBe(true);
    expect(consoleState.sourceMetadata[0]).toMatchObject({
      title: "Sensitive source",
      rawContentHidden: true,
    });
    expect(consoleState.sourceMetadata[0].rawTextPreview).toBeUndefined();
    expect(consoleState.auditLogs.some((entry) => entry.action === "admin.console.viewed")).toBe(true);
  });

  it("exposes raw source preview only with explicit privileged access and records audit", async () => {
    const consoleState = await getAdminConsole(adminContext, {
      includeRawSourceContent: true,
      privilegedReason: "support ticket",
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        orgId,
        action: "admin.raw_source_access",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(consoleState.sourceMetadata[0].rawContentHidden).toBe(false);
    expect(consoleState.sourceMetadata[0].rawTextPreview).toContain("Raw sensitive source content");
    expect(audit.metadata).toMatchObject({ reason: "support ticket" });
  });
});
