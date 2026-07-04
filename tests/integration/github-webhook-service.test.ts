import { createHmac } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  handleGitHubWebhook,
  replayGitHubWebhookDelivery,
} from "@/services/github-webhook-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const webhookSecret = ["test", "webhook", "secret"].join("-");
const pullRequestDeliveryId = `delivery-pr-${suffix}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("github webhook service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `webhook-user-${suffix}`,
        email: `webhook-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Webhook Org ${suffix}`,
        slug: `webhook-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });

    const project = await createProject(context, {
      name: `Webhook Project ${suffix}`,
    });

    projectId = project.id;

    await prisma.githubInstallation.create({
      data: {
        orgId,
        installationId: "999111",
        accountLogin: "foundermafstat",
        accountType: "Organization",
        status: "CONNECTED",
      },
    });
    await prisma.sourceConnection.create({
      data: {
        orgId,
        projectId,
        provider: "GITHUB",
        status: "CONNECTED",
        externalId: "999111:foundermafstat/storro",
        displayName: "foundermafstat/storro",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("rejects unsigned or invalid webhook deliveries", async () => {
    await expect(
      handleGitHubWebhook({
        deliveryId: "delivery-invalid",
        eventType: "pull_request",
        signature256: null,
        rawBody: "{}",
        webhookSecret,
      }),
    ).rejects.toThrow("Invalid GitHub webhook signature.");
  });

  it("persists valid PR webhook once and enqueues one processing job", async () => {
    const rawBody = JSON.stringify({
      action: "opened",
      installation: { id: 999111 },
      pull_request: { number: 42 },
      repository: { full_name: "foundermafstat/storro" },
    });
    const first = await handleGitHubWebhook({
      deliveryId: pullRequestDeliveryId,
      eventType: "pull_request",
      signature256: sign(rawBody),
      rawBody,
      webhookSecret,
    });
    const duplicate = await handleGitHubWebhook({
      deliveryId: pullRequestDeliveryId,
      eventType: "pull_request",
      signature256: sign(rawBody),
      rawBody,
      webhookSecret,
    });
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        provider: "GITHUB",
        deliveryId: pullRequestDeliveryId,
      },
    });
    const jobs = await prisma.job.findMany({
      where: {
        orgId,
        type: "WEBHOOK_PROCESS",
      },
    });

    expect(first.job).toMatchObject({
      type: "WEBHOOK_PROCESS",
      projectId,
    });
    expect(duplicate.duplicate).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });

  it("replays stored webhook deliveries into processing jobs", async () => {
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({
      where: {
        provider: "GITHUB",
        deliveryId: pullRequestDeliveryId,
      },
    });
    const replay = await replayGitHubWebhookDelivery(context, {
      deliveryId: delivery.id,
    });

    expect(replay.delivery.status).toBe("PROCESSING");
    expect(replay.job).toMatchObject({
      type: "WEBHOOK_PROCESS",
      projectId,
    });
  });
});

function sign(rawBody: string) {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}
