import { createHmac, timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertIntegrationManagement } from "@/services/authorization-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

const supportedGitHubEvents = new Set(["push", "pull_request", "release", "issues", "workflow_run"]);

export async function handleGitHubWebhook(
  input: {
    deliveryId?: string | null;
    eventType?: string | null;
    signature256?: string | null;
    rawBody: string;
    webhookSecret: string;
  },
  db: DatabaseClient = prisma,
) {
  if (!input.deliveryId) {
    throw new ValidationServiceError("Missing GitHub delivery id.");
  }

  if (!input.eventType || !supportedGitHubEvents.has(input.eventType)) {
    throw new ValidationServiceError("Unsupported GitHub webhook event.");
  }

  if (!verifyGitHubWebhookSignature(input.rawBody, input.signature256, input.webhookSecret)) {
    throw new ValidationServiceError("Invalid GitHub webhook signature.");
  }

  const existing = await db.webhookDelivery.findUnique({
    where: {
      provider_deliveryId: {
        provider: "GITHUB",
        deliveryId: input.deliveryId,
      },
    },
  });

  if (existing) {
    return {
      delivery: existing,
      job: null,
      duplicate: true,
    };
  }

  const payload = parseWebhookPayload(input.rawBody);
  const installationId = readInstallationId(payload);
  const installation = installationId
    ? await db.githubInstallation.findFirst({
        where: {
          installationId,
        },
      })
    : null;
  const projectIds = installationId ? await findMappedProjectIds(db, installationId) : [];
  const status = installation ? "RECEIVED" : "IGNORED";
  const delivery = await db.webhookDelivery.create({
    data: {
      orgId: installation?.orgId,
      provider: "GITHUB",
      deliveryId: input.deliveryId,
      eventType: input.eventType,
      status,
      signatureValid: true,
      payload: payload as Prisma.InputJsonObject,
      error: installation ? undefined : "No connected GitHub installation found.",
    },
  });
  const job = installation
    ? await db.job.create({
        data: {
          orgId: installation.orgId,
          projectId: projectIds[0],
          type: "WEBHOOK_PROCESS",
          status: "QUEUED",
          queueName: "github-webhooks",
          payload: {
            deliveryId: delivery.id,
            githubDeliveryId: input.deliveryId,
            eventType: input.eventType,
            installationId,
            projectIds,
            action: isRecord(payload) && typeof payload.action === "string" ? payload.action : undefined,
          },
        },
      })
    : null;

  return {
    delivery,
    job,
    duplicate: false,
  };
}

export async function replayGitHubWebhookDelivery(
  context: ScopedContext,
  input: {
    deliveryId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);

  const delivery = await db.webhookDelivery.findFirst({
    where: {
      id: input.deliveryId,
      provider: "GITHUB",
      orgId: context.orgId,
    },
  });

  if (!delivery) {
    throw new NotFoundError("Webhook delivery not found.");
  }

  if (!delivery.signatureValid) {
    throw new ValidationServiceError("Cannot replay a webhook with invalid signature.");
  }

  const payload = isRecord(delivery.payload) ? delivery.payload : {};
  const installationId = readInstallationId(payload);
  const projectIds = installationId ? await findMappedProjectIds(db, installationId) : [];
  const job = await db.job.create({
    data: {
      orgId: context.orgId,
      projectId: projectIds[0],
      type: "WEBHOOK_PROCESS",
      status: "QUEUED",
      queueName: "github-webhooks",
      payload: {
        deliveryId: delivery.id,
        githubDeliveryId: delivery.deliveryId,
        eventType: delivery.eventType,
        installationId,
        projectIds,
        replayed: true,
      },
    },
  });
  const updated = await db.webhookDelivery.update({
    where: {
      id: delivery.id,
    },
    data: {
      status: "PROCESSING",
    },
  });

  return {
    delivery: updated,
    job,
  };
}

export function verifyGitHubWebhookSignature(rawBody: string, signature256: string | null | undefined, webhookSecret: string) {
  if (!signature256?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signature256);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseWebhookPayload(rawBody: string) {
  try {
    const payload = JSON.parse(rawBody) as unknown;

    if (!isRecord(payload)) {
      throw new Error("payload must be object");
    }

    return payload;
  } catch {
    throw new ValidationServiceError("Invalid GitHub webhook JSON payload.");
  }
}

async function findMappedProjectIds(db: DatabaseClient, installationId: string) {
  const connections = await db.sourceConnection.findMany({
    where: {
      provider: "GITHUB",
      status: "CONNECTED",
      externalId: {
        startsWith: `${installationId}:`,
      },
    },
    select: {
      projectId: true,
    },
  });

  return [...new Set(connections.map((connection) => connection.projectId).filter((projectId): projectId is string => !!projectId))];
}

function readInstallationId(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.installation)) {
    return undefined;
  }

  const id = payload.installation.id;

  return typeof id === "number" || typeof id === "string" ? String(id) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
