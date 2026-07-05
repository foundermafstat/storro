import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertAdminAccess, assertIntegrationManagement } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { NotFoundError, RateLimitError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

export function encryptSecret(plaintext: string, encryptionKey: string) {
  if (!plaintext) {
    throw new ValidationServiceError("Secret value is required.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string, encryptionKey: string) {
  const [version, iv, authTag, ciphertext] = payload.split(":");

  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    throw new ValidationServiceError("Encrypted secret payload is invalid.");
  }

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(encryptionKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function storeEncryptedIntegrationToken(
  context: ScopedContext,
  input: {
    connectionId: string;
    token: string;
    encryptionKey: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);

  const connection = await db.sourceConnection.findFirst({
    where: {
      id: input.connectionId,
      orgId: context.orgId,
    },
  });

  if (!connection) {
    throw new NotFoundError("Source connection not found.");
  }

  return db.sourceConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      encryptedToken: encryptSecret(input.token, input.encryptionKey),
    },
  });
}

export function assertSecurityRateLimit(
  key: string,
  input: {
    limit: number;
    windowMs: number;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return;
  }

  if (current.count >= input.limit) {
    throw new RateLimitError("Security rate limit exceeded.", {
      key,
      limit: input.limit,
      resetAt: new Date(current.resetAt).toISOString(),
    });
  }

  current.count += 1;
}

export function resetSecurityRateLimits() {
  rateBuckets.clear();
}

export async function exportOrganizationData(
  context: ScopedContext,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertAdminAccess(context, db);

  const [organization, projects, sources, artifacts, users, usageEvents] = await Promise.all([
    db.organization.findUnique({ where: { id: context.orgId } }),
    db.project.count({ where: { orgId: context.orgId } }),
    db.sourceDocument.count({ where: { orgId: context.orgId } }),
    db.storyArtifact.count({ where: { orgId: context.orgId } }),
    db.membership.findMany({ where: { orgId: context.orgId }, include: { user: true } }),
    db.usageEvent.findMany({ where: { orgId: context.orgId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  await recordAuditEvent(context, {
    action: "security.organization_exported",
    entityType: "Organization",
    entityId: context.orgId,
  }, db);

  return {
    organization,
    counts: {
      projects,
      sources,
      artifacts,
      users: users.length,
    },
    users: users.map((membership) => ({
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
    })),
    usageEvents,
    exportedAt: new Date().toISOString(),
  };
}

export async function deleteOrganizationData(
  context: ScopedContext,
  input: {
    confirmOrgSlug: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertAdminAccess(context, db);

  const organization = await db.organization.findUnique({
    where: {
      id: context.orgId,
    },
  });

  if (!organization) {
    throw new NotFoundError("Organization not found.");
  }

  if (input.confirmOrgSlug !== organization.slug) {
    throw new ValidationServiceError("Organization deletion confirmation does not match.");
  }

  const memberships = await db.membership.findMany({
    where: {
      orgId: context.orgId,
    },
  });
  const anonymizeUserIds = [];

  for (const membership of memberships) {
    const membershipCount = await db.membership.count({
      where: {
        userId: membership.userId,
      },
    });

    if (membershipCount === 1) {
      anonymizeUserIds.push(membership.userId);
    }
  }

  await db.organization.delete({
    where: {
      id: organization.id,
    },
  });

  for (const userId of anonymizeUserIds) {
    await db.user.update({
      where: {
        id: userId,
      },
      data: {
        authUserId: `deleted-${userId}`,
        email: null,
        name: "Deleted user",
        imageUrl: null,
      },
    });
  }

  return {
    deletedOrgId: organization.id,
    anonymizedUserIds: anonymizeUserIds,
  };
}

function deriveKey(encryptionKey: string) {
  if (encryptionKey.length < 32) {
    throw new ValidationServiceError("Encryption key must be at least 32 characters.");
  }

  return createHash("sha256").update(encryptionKey).digest();
}
