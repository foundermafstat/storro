ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'FILE_UPLOAD';

ALTER TABLE "SourceDocument"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "SourceDocument_orgId_projectId_isPrivate_createdAt_idx"
  ON "SourceDocument"("orgId", "projectId", "isPrivate", "createdAt");
