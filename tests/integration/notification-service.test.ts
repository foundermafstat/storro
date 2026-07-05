import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  emitOrganizationNotification,
  listInAppNotifications,
  notifyJobCompletion,
  type NotificationEmailProvider,
  upsertNotificationPreference,
} from "@/services/notification-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

function emailRecorder(sent: Array<{ to: string; subject: string; notificationId: string }>): NotificationEmailProvider {
  return {
    async sendEmail(input) {
      sent.push({
        to: input.to,
        subject: input.subject,
        notificationId: input.notificationId,
      });
    },
  };
}

describe("notification service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `notify-user-${suffix}`, email: `notify-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Notify Org ${suffix}`, slug: `notify-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
    const project = await createProject(context, { name: `Notify Project ${suffix}` });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates an in-app notification after job completion", async () => {
    const job = await prisma.job.create({
      data: {
        orgId,
        projectId,
        type: "STORY_GENERATION",
        status: "COMPLETED",
        queueName: "artifact-generation",
        payload: {},
      },
    });

    await notifyJobCompletion(context, { jobId: job.id });
    const notifications = await listInAppNotifications(context);

    expect(notifications[0]).toMatchObject({
      type: "GENERATION_COMPLETE",
      title: "Generation complete",
      entityType: "Job",
      entityId: job.id,
    });
  });

  it("lets users disable non-critical email while keeping in-app notifications", async () => {
    const sent: Array<{ to: string; subject: string; notificationId: string }> = [];
    await upsertNotificationPreference(context, {
      scope: "USER",
      disabledEmailTypes: ["GENERATION_COMPLETE"],
    });
    await emitOrganizationNotification(
      context,
      {
        projectId,
        type: "GENERATION_COMPLETE",
        title: "Generation complete",
        body: "A generated artifact is ready.",
        entityType: "StoryArtifact",
        entityId: `artifact-${suffix}`,
        dedupeKey: `email-disabled-${suffix}`,
      },
      emailRecorder(sent),
    );
    const notifications = await listInAppNotifications(context);

    expect(sent).toEqual([]);
    expect(notifications.some((notification) => notification.dedupeKey.includes(`email-disabled-${suffix}`))).toBe(true);
  });

  it("keeps critical billing and integration errors in-app even when in-app is disabled", async () => {
    await upsertNotificationPreference(context, {
      scope: "USER",
      inAppEnabled: false,
      disabledInAppTypes: ["BILLING_ISSUE", "GITHUB_SYNC_FAILED"],
    });
    await emitOrganizationNotification(context, {
      projectId,
      type: "BILLING_ISSUE",
      title: "Billing issue",
      body: "Payment failed.",
      entityType: "BillingAccount",
      entityId: `billing-${suffix}`,
      dedupeKey: `critical-billing-${suffix}`,
    });
    await emitOrganizationNotification(context, {
      projectId,
      type: "GITHUB_SYNC_FAILED",
      title: "GitHub sync failed",
      body: "Reconnect GitHub.",
      entityType: "SourceConnection",
      entityId: `github-${suffix}`,
      dedupeKey: `critical-github-${suffix}`,
    });
    const notifications = await listInAppNotifications(context);

    expect(notifications.some((notification) => notification.type === "BILLING_ISSUE")).toBe(true);
    expect(notifications.some((notification) => notification.type === "GITHUB_SYNC_FAILED")).toBe(true);
  });

  it("deduplicates repeated notifications by key", async () => {
    await upsertNotificationPreference(context, {
      scope: "USER",
      inAppEnabled: true,
      disabledInAppTypes: [],
      disabledEmailTypes: [],
    });
    const input = {
      projectId,
      type: "QUOTA_WARNING" as const,
      title: "Quota warning",
      body: "Usage is approaching the limit.",
      entityType: "UsageEvent",
      entityId: `usage-${suffix}`,
      dedupeKey: `quota-dedupe-${suffix}`,
    };

    await emitOrganizationNotification(context, input);
    await emitOrganizationNotification(context, input);
    const count = await prisma.notification.count({
      where: {
        orgId,
        userId,
        dedupeKey: {
          contains: `quota-dedupe-${suffix}`,
        },
      },
    });

    expect(count).toBe(1);
  });
});
