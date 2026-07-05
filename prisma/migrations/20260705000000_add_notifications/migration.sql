CREATE TYPE "NotificationType" AS ENUM (
  'EXTRACTION_COMPLETE',
  'GENERATION_COMPLETE',
  'GROUNDING_FAILED',
  'GITHUB_SYNC_FAILED',
  'WEBHOOK_DISCONNECTED',
  'QUOTA_WARNING',
  'BILLING_ISSUE',
  'EXPORT_READY'
);

CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TYPE "NotificationPreferenceScope" AS ENUM ('ORG_DEFAULT', 'USER');

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "channels" JSONB,
  "readAt" TIMESTAMP(3),
  "emailedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT,
  "subjectId" TEXT NOT NULL,
  "scope" "NotificationPreferenceScope" NOT NULL DEFAULT 'USER',
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "disabledEmailTypes" "NotificationType"[] NOT NULL DEFAULT ARRAY[]::"NotificationType"[],
  "disabledInAppTypes" "NotificationType"[] NOT NULL DEFAULT ARRAY[]::"NotificationType"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_orgId_userId_dedupeKey_key" ON "Notification"("orgId", "userId", "dedupeKey");
CREATE INDEX "Notification_orgId_userId_readAt_createdAt_idx" ON "Notification"("orgId", "userId", "readAt", "createdAt");
CREATE INDEX "Notification_projectId_type_idx" ON "Notification"("projectId", "type");
CREATE INDEX "Notification_orgId_type_severity_idx" ON "Notification"("orgId", "type", "severity");

CREATE UNIQUE INDEX "NotificationPreference_orgId_subjectId_key" ON "NotificationPreference"("orgId", "subjectId");
CREATE INDEX "NotificationPreference_orgId_scope_idx" ON "NotificationPreference"("orgId", "scope");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
