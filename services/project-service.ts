import type { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  assertOrgPermission,
  assertProjectPermission,
} from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { assertQuota } from "@/services/billing-service";
import { ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ProjectVisibilityStatus = "PRIVATE" | "ORGANIZATION" | "PUBLIC";

export type ProjectSettings = {
  visibility: ProjectVisibilityStatus;
  sourcePrivacyDefault: boolean;
  aiReviewRequired: boolean;
  defaultArtifactFormat?: string;
  billingCode?: string;
};

export type ProjectListOptions = {
  search?: string;
  tags?: string[];
  status?: ProjectStatus;
  includeArchived?: boolean;
};

export type ProjectMetadataInput = Record<string, unknown>;

export type ProjectMutationInput = {
  name?: string;
  slug?: string;
  description?: string | null;
  tags?: string[];
  metadata?: ProjectMetadataInput;
  settings?: Partial<ProjectSettings>;
};

export const defaultProjectSettings: ProjectSettings = {
  visibility: "PRIVATE",
  sourcePrivacyDefault: true,
  aiReviewRequired: true,
};

export async function listProjects(
  context: ScopedContext,
  options: ProjectListOptions = {},
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  const where: Prisma.ProjectWhereInput = {
    orgId: context.orgId,
  };

  if (!options.includeArchived) {
    where.archivedAt = null;
  }

  if (options.status) {
    where.status = options.status;
  }

  const search = options.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const tags = normalizeTags(options.tags);
  if (tags.length > 0) {
    where.tags = {
      hasEvery: tags,
    };
  }

  return db.project.findMany({
    where,
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function listArchivedProjects(context: ScopedContext, db: DatabaseClient = prisma) {
  return listProjects(context, { includeArchived: true, status: "ARCHIVED" }, db);
}

export async function getProjectById(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.read", db);

  return db.project.findFirst({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
  });
}

export async function createProject(
  context: ScopedContext,
  input: ProjectMutationInput & { name: string },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertOrgPermission(context, "project.write", db);
  await assertQuota(context, { resource: "projects" }, db);

  const slug = normalizeProjectSlug(input.slug ?? input.name);

  const project = await db.project.create({
    data: {
      orgId: context.orgId,
      ownerId: context.userId,
      name: input.name,
      slug,
      description: input.description ?? null,
      tags: normalizeTags(input.tags),
      metadata: buildProjectMetadata(input.metadata, input.settings),
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}

export async function updateProject(
  context: ScopedContext,
  projectId: string,
  input: ProjectMutationInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, projectId, "project.write", db);

  const existing = await db.project.findFirstOrThrow({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    select: {
      metadata: true,
    },
  });

  const data: Prisma.ProjectUpdateInput = {};

  if (input.name !== undefined) {
    data.name = input.name;
  }

  if (input.slug !== undefined) {
    data.slug = normalizeProjectSlug(input.slug);
  }

  if (input.description !== undefined) {
    data.description = input.description;
  }

  if (input.tags !== undefined) {
    data.tags = normalizeTags(input.tags);
  }

  if (input.metadata !== undefined || input.settings !== undefined) {
    data.metadata = buildProjectMetadata(
      mergeMetadata(existing.metadata, input.metadata),
      input.settings,
    );
  }

  const project = await db.project.update({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    data,
  });

  await recordAuditEvent(
    context,
    {
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}

export async function updateProjectSettings(
  context: ScopedContext,
  projectId: string,
  settings: Partial<ProjectSettings>,
  db: DatabaseClient = prisma,
) {
  return updateProject(context, projectId, { settings }, db);
}

export async function archiveProject(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, projectId, "project.archive", db);

  const project = await db.project.update({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "project.archived",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}

export async function restoreProject(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, projectId, "project.archive", db);

  const project = await db.project.update({
    where: {
      id: projectId,
      orgId: context.orgId,
    },
    data: {
      status: "ACTIVE",
      archivedAt: null,
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "project.restored",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    },
    db,
  );

  return project;
}

export async function getProjectDashboardSummary(
  context: ScopedContext,
  projectId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, projectId, "project.read", db);

  const [
    sourceCount,
    extractionCount,
    artifactCount,
    integrationCount,
    recentJobs,
    usageAggregate,
  ] = await Promise.all([
    db.sourceDocument.count({
      where: {
        orgId: context.orgId,
        projectId,
        deletedAt: null,
      },
    }),
    db.extractionRun.count({
      where: {
        orgId: context.orgId,
        projectId,
      },
    }),
    db.storyArtifact.count({
      where: {
        orgId: context.orgId,
        projectId,
        archivedAt: null,
      },
    }),
    db.sourceConnection.count({
      where: {
        orgId: context.orgId,
        projectId,
      },
    }),
    db.job.findMany({
      where: {
        orgId: context.orgId,
        projectId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
      select: {
        id: true,
        type: true,
        status: true,
        queueName: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.usageEvent.aggregate({
      where: {
        orgId: context.orgId,
        projectId,
      },
      _sum: {
        quantity: true,
      },
    }),
  ]);

  return {
    cards: {
      sources: sourceCount,
      extractions: extractionCount,
      artifacts: artifactCount,
      integrations: integrationCount,
      recentJobs: recentJobs.length,
      usage: usageAggregate._sum.quantity ?? 0,
    },
    recentJobs,
  };
}

export function extractProjectSettings(metadata: Prisma.JsonValue | null | undefined): ProjectSettings {
  const settings = readSettings(metadata);

  return {
    visibility: parseVisibility(settings.visibility),
    sourcePrivacyDefault:
      typeof settings.sourcePrivacyDefault === "boolean"
        ? settings.sourcePrivacyDefault
        : defaultProjectSettings.sourcePrivacyDefault,
    aiReviewRequired:
      typeof settings.aiReviewRequired === "boolean"
        ? settings.aiReviewRequired
        : defaultProjectSettings.aiReviewRequired,
    defaultArtifactFormat:
      typeof settings.defaultArtifactFormat === "string" ? settings.defaultArtifactFormat : undefined,
    billingCode: typeof settings.billingCode === "string" ? settings.billingCode : undefined,
  };
}

function buildProjectMetadata(
  metadata?: ProjectMetadataInput,
  settings?: Partial<ProjectSettings>,
): Prisma.InputJsonObject {
  const base = toInputJsonObject(metadata);
  const mergedSettings = {
    ...defaultProjectSettings,
    ...readSettings(base),
    ...settings,
  };

  return {
    ...base,
    settings: {
      ...mergedSettings,
      visibility: parseVisibility(mergedSettings.visibility),
    },
  };
}

function mergeMetadata(
  existing: Prisma.JsonValue | null,
  incoming?: ProjectMetadataInput,
): Prisma.InputJsonObject {
  if (!incoming) {
    return toInputJsonObject(existing);
  }

  return {
    ...toInputJsonObject(existing),
    ...toInputJsonObject(incoming),
  };
}

function normalizeProjectSlug(input: string) {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new ValidationServiceError("Project slug is required.");
  }

  return slug;
}

function normalizeTags(tags: string[] | undefined) {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function readSettings(
  metadata: Prisma.JsonValue | Prisma.InputJsonObject | null | undefined,
): Record<string, unknown> {
  if (!isRecord(metadata) || !isRecord(metadata.settings)) {
    return {};
  }

  return metadata.settings;
}

function parseVisibility(value: unknown): ProjectVisibilityStatus {
  if (value === "ORGANIZATION" || value === "PUBLIC" || value === "PRIVATE") {
    return value;
  }

  return defaultProjectSettings.visibility;
}

function toInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return isRecord(value) ? (value as Prisma.InputJsonObject) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
