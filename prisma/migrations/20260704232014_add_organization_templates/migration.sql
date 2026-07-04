-- CreateEnum
CREATE TYPE "TemplatePrivateFactPolicy" AS ENUM ('PUBLIC_ONLY', 'INTERNAL_ALLOWED', 'PRIVATE_ALLOWED');

-- CreateTable
CREATE TABLE "OrganizationTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "format" "ArtifactFormat" NOT NULL,
    "audience" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "requiredSections" TEXT[],
    "lengthLimits" JSONB NOT NULL,
    "privateFactPolicy" "TemplatePrivateFactPolicy" NOT NULL,
    "groundingRules" JSONB NOT NULL,
    "minimumPlan" TEXT NOT NULL DEFAULT 'team',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationTemplate_orgId_format_archivedAt_idx" ON "OrganizationTemplate"("orgId", "format", "archivedAt");

-- CreateIndex
CREATE INDEX "OrganizationTemplate_minimumPlan_idx" ON "OrganizationTemplate"("minimumPlan");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationTemplate_orgId_templateId_key" ON "OrganizationTemplate"("orgId", "templateId");

-- AddForeignKey
ALTER TABLE "OrganizationTemplate" ADD CONSTRAINT "OrganizationTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationTemplate" ADD CONSTRAINT "OrganizationTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
