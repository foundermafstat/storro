import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  disconnectGitHubFromSettings,
  enqueueGitHubResync,
  getIntegrationSettings,
} from "@/services/integration-settings-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let connectionId = "";
let context: ScopedContext;

describe("integration settings service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `settings-user-${suffix}`, email: `settings-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Settings Org ${suffix}`, slug: `settings-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
    const project = await createProject(context, { name: `Settings Project ${suffix}` });
    projectId = project.id;
    await prisma.githubInstallation.create({ data: { orgId, installationId: "404040", accountLogin: "foundermafstat", accountType: "Organization", status: "CONNECTED" } });
    const connection = await prisma.sourceConnection.create({
      data: {
        orgId,
        projectId,
        provider: "GITHUB",
        status: "ERROR",
        externalId: "404040:foundermafstat/storro",
        displayName: "foundermafstat/storro",
        metadata: { lastError: { message: "permission denied" } },
      },
    });
    await prisma.webhookDelivery.create({ data: { orgId, provider: "GITHUB", deliveryId: `settings-${suffix}`, eventType: "pull_request", status: "PROCESSED", signatureValid: true, payload: {} } });
    await prisma.usageEvent.create({ data: { orgId, projectId, userId, type: "AI_GENERATION", quantity: 7 } });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("shows connected and error states with webhook status and actionable copy", async () => {
    const settings = await getIntegrationSettings(context);
    expect(settings.github[0].status).toBe("CONNECTED");
    expect(settings.github[0].connections[0]).toMatchObject({
      status: "ERROR",
      projectId,
      projectName: `Settings Project ${suffix}`,
      actionableCopy: "Review permissions, reconnect the integration, or retry sync.",
    });
    expect(settings.webhooks?.eventType).toBe("pull_request");
    expect(settings.openaiUsage.AI_GENERATION.quantity).toBe(7);
  });

  it("can resync and disconnect GitHub", async () => {
    const job = await enqueueGitHubResync(context, { connectionId });
    expect(job.type).toBe("GITHUB_SYNC");
    const settings = await getIntegrationSettings(context);
    expect(settings.audit.some((entry) => entry.action === "github.connection.resync_requested")).toBe(true);
    const disconnected = await disconnectGitHubFromSettings(context, { installationId: "404040" });
    expect(disconnected.status).toBe("DISCONNECTED");
  });
});
