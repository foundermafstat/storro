import type { NotificationSeverity, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertOrgPermission } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type NotificationEmailProvider = {
  sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    notificationId: string;
  }): Promise<void>;
};

type NotificationInput = {
  projectId?: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  severity?: NotificationSeverity;
  dedupeKey?: string;
};

type PreferenceInput = {
  scope: "ORG_DEFAULT" | "USER";
  userId?: string;
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  disabledEmailTypes?: NotificationType[];
  disabledInAppTypes?: NotificationType[];
};

type EffectivePreference = {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  disabledEmailTypes: NotificationType[];
  disabledInAppTypes: NotificationType[];
};

const defaultPreference: EffectivePreference = {
  emailEnabled: true,
  inAppEnabled: true,
  disabledEmailTypes: [],
  disabledInAppTypes: [],
};

export async function listInAppNotifications(
  context: ScopedContext,
  input: {
    unreadOnly?: boolean;
    limit?: number;
  } = {},
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  return db.notification.findMany({
    where: {
      orgId: context.orgId,
      userId: context.userId,
      readAt: input.unreadOnly ? null : undefined,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.min(Math.max(input.limit ?? 50, 1), 100),
  });
}

export async function markNotificationRead(
  context: ScopedContext,
  input: {
    notificationId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const notification = await db.notification.findFirst({
    where: {
      id: input.notificationId,
      orgId: context.orgId,
      userId: context.userId,
    },
  });

  if (!notification) {
    throw new NotFoundError("Notification not found.");
  }

  return db.notification.update({
    where: {
      id: notification.id,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function upsertNotificationPreference(
  context: ScopedContext,
  input: PreferenceInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, input.scope === "ORG_DEFAULT" ? "admin.access" : "project.read", db);

  const subjectId = input.scope === "ORG_DEFAULT" ? "org_default" : `user:${input.userId ?? context.userId}`;
  const userId = input.scope === "USER" ? input.userId ?? context.userId : undefined;

  if (input.scope === "USER" && !userId) {
    throw new ValidationServiceError("User notification preference requires a user id.");
  }

  return db.notificationPreference.upsert({
    where: {
      orgId_subjectId: {
        orgId: context.orgId,
        subjectId,
      },
    },
    update: {
      userId,
      scope: input.scope,
      emailEnabled: input.emailEnabled,
      inAppEnabled: input.inAppEnabled,
      disabledEmailTypes: input.disabledEmailTypes,
      disabledInAppTypes: input.disabledInAppTypes,
    },
    create: {
      orgId: context.orgId,
      userId,
      subjectId,
      scope: input.scope,
      emailEnabled: input.emailEnabled ?? true,
      inAppEnabled: input.inAppEnabled ?? true,
      disabledEmailTypes: input.disabledEmailTypes ?? [],
      disabledInAppTypes: input.disabledInAppTypes ?? [],
    },
  });
}

export async function emitOrganizationNotification(
  context: ScopedContext,
  input: NotificationInput,
  emailProvider?: NotificationEmailProvider,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const memberships = await db.membership.findMany({
    where: {
      orgId: context.orgId,
    },
    include: {
      user: true,
    },
  });
  const notifications = [];

  for (const membership of memberships) {
    const severity = input.severity ?? severityForType(input.type);
    const preference = await getEffectivePreference(context.orgId, membership.userId, db);
    const shouldCreateInApp = severity === "CRITICAL"
      || (preference.inAppEnabled && !preference.disabledInAppTypes.includes(input.type));
    const shouldEmail = Boolean(
      emailProvider
      && membership.user.email
      && preference.emailEnabled
      && (severity === "CRITICAL" || !preference.disabledEmailTypes.includes(input.type)),
    );

    if (!shouldCreateInApp && !shouldEmail) {
      continue;
    }

    const dedupeKey = `${input.dedupeKey ?? `${input.type}:${input.entityType ?? "event"}:${input.entityId ?? "none"}`}:${membership.userId}`;
    const notification = await db.notification.upsert({
      where: {
        orgId_userId_dedupeKey: {
          orgId: context.orgId,
          userId: membership.userId,
          dedupeKey,
        },
      },
      update: {
        projectId: input.projectId,
        type: input.type,
        severity,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        channels: {
          inApp: shouldCreateInApp,
          email: shouldEmail,
        } as Prisma.InputJsonObject,
      },
      create: {
        orgId: context.orgId,
        projectId: input.projectId,
        userId: membership.userId,
        type: input.type,
        severity,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey,
        channels: {
          inApp: shouldCreateInApp,
          email: shouldEmail,
        } as Prisma.InputJsonObject,
      },
    });

    if (shouldEmail && membership.user.email) {
      await emailProvider?.sendEmail({
        to: membership.user.email,
        subject: input.title,
        text: input.body,
        notificationId: notification.id,
      });
      notifications.push(await db.notification.update({
        where: {
          id: notification.id,
        },
        data: {
          emailedAt: new Date(),
        },
      }));
    } else {
      notifications.push(notification);
    }
  }

  return notifications;
}

export async function notifyJobCompletion(
  context: ScopedContext,
  input: {
    jobId: string;
  },
  emailProvider?: NotificationEmailProvider,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const job = await db.job.findFirst({
    where: {
      id: input.jobId,
      orgId: context.orgId,
    },
  });

  if (!job) {
    throw new NotFoundError("Job not found.");
  }

  const notification = notificationForJob(job.type, job.status);

  if (!notification) {
    return [];
  }

  return emitOrganizationNotification(
    context,
    {
      ...notification,
      projectId: job.projectId ?? undefined,
      entityType: "Job",
      entityId: job.id,
      dedupeKey: `job:${job.id}:${job.status}`,
    },
    emailProvider,
    db,
  );
}

async function getEffectivePreference(orgId: string, userId: string, db: DatabaseClient): Promise<EffectivePreference> {
  const [orgDefault, userPreference] = await Promise.all([
    db.notificationPreference.findUnique({
      where: {
        orgId_subjectId: {
          orgId,
          subjectId: "org_default",
        },
      },
    }),
    db.notificationPreference.findUnique({
      where: {
        orgId_subjectId: {
          orgId,
          subjectId: `user:${userId}`,
        },
      },
    }),
  ]);
  const base = orgDefault
    ? {
        emailEnabled: orgDefault.emailEnabled,
        inAppEnabled: orgDefault.inAppEnabled,
        disabledEmailTypes: orgDefault.disabledEmailTypes,
        disabledInAppTypes: orgDefault.disabledInAppTypes,
      }
    : defaultPreference;

  return userPreference
    ? {
        emailEnabled: userPreference.emailEnabled,
        inAppEnabled: userPreference.inAppEnabled,
        disabledEmailTypes: userPreference.disabledEmailTypes,
        disabledInAppTypes: userPreference.disabledInAppTypes,
      }
    : base;
}

function notificationForJob(type: string, status: string): NotificationInput | undefined {
  if (status === "COMPLETED" && type === "EXTRACTION") {
    return {
      type: "EXTRACTION_COMPLETE",
      title: "Extraction complete",
      body: "Project facts are ready for review.",
    };
  }
  if (status === "COMPLETED" && type === "STORY_GENERATION") {
    return {
      type: "GENERATION_COMPLETE",
      title: "Generation complete",
      body: "A new story artifact is ready.",
    };
  }
  if (status === "COMPLETED" && type === "EXPORT") {
    return {
      type: "EXPORT_READY",
      title: "Export ready",
      body: "The artifact export is ready to download.",
    };
  }
  if (status === "FAILED" && type === "GROUNDING_REVIEW") {
    return {
      type: "GROUNDING_FAILED",
      title: "Grounding review failed",
      body: "Review the artifact and source evidence before publishing.",
    };
  }
  if (status === "FAILED" && type === "GITHUB_SYNC") {
    return {
      type: "GITHUB_SYNC_FAILED",
      title: "GitHub sync failed",
      body: "Reconnect GitHub or retry the repository sync.",
    };
  }
  if (status === "FAILED" && type === "WEBHOOK_PROCESS") {
    return {
      type: "WEBHOOK_DISCONNECTED",
      title: "Webhook disconnected",
      body: "Webhook deliveries are failing and need integration attention.",
    };
  }
  if (status === "FAILED" && type === "BILLING_RECONCILE") {
    return {
      type: "BILLING_ISSUE",
      title: "Billing issue",
      body: "Billing reconciliation failed and needs account attention.",
    };
  }

  return undefined;
}

function severityForType(type: NotificationType): NotificationSeverity {
  if (type === "BILLING_ISSUE" || type === "GITHUB_SYNC_FAILED" || type === "WEBHOOK_DISCONNECTED") {
    return "CRITICAL";
  }
  if (type === "GROUNDING_FAILED" || type === "QUOTA_WARNING") {
    return "WARNING";
  }

  return "INFO";
}
