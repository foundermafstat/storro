import type { Prisma, SourceType } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  assertProjectPermission,
  assertSourcePermission,
} from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type SourceProvenanceKind =
  | "manual_input"
  | "file_upload"
  | "github"
  | "chatgpt"
  | "codex"
  | "cli"
  | "mcp"
  | "webhook";

export type SourceProvenanceInput = {
  kind: SourceProvenanceKind;
  externalId?: string;
  externalUrl?: string;
  actor?: string;
  importedAt?: Date;
};

export type SourceDocumentCreateInput = {
  projectId: string;
  title: string;
  body?: string;
  rawObjectKey?: string;
  sourceType?: SourceType;
  provenance?: SourceProvenanceInput;
  metadata?: Record<string, unknown>;
  tags?: string[];
  isPrivate?: boolean;
  sourceCreatedAt?: Date;
};

export type SourceDocumentUpdateInput = {
  title?: string;
  body?: string | null;
  rawObjectKey?: string | null;
  metadata?: Record<string, unknown>;
  tags?: string[];
  isPrivate?: boolean;
  sourceCreatedAt?: Date | null;
};

export type SourceDocumentListOptions = {
  projectId: string;
  sourceType?: SourceType;
  tags?: string[];
  isPrivate?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  search?: string;
  includeDeleted?: boolean;
};

export async function createSourceDocument(
  context: ScopedContext,
  input: SourceDocumentCreateInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);

  const sourceType = input.sourceType ?? classifySourceType(input.provenance);
  const source = await db.sourceDocument.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      createdById: context.userId,
      sourceType,
      status: "CREATED",
      title: input.title,
      rawText: input.body,
      rawObjectKey: input.rawObjectKey,
      metadata: buildSourceMetadata(input.metadata, input.provenance),
      tags: normalizeTags(input.tags),
      isPrivate: input.isPrivate ?? false,
      sourceCreatedAt: input.sourceCreatedAt,
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "source.created",
      entityType: "sourceDocument",
      entityId: source.id,
      projectId: input.projectId,
      metadata: {
        sourceType,
      },
    },
    db,
  );

  return source;
}

export async function createManualSourceDocument(
  context: ScopedContext,
  input: {
    projectId: string;
    title: string;
    body: string;
    isPrivate?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  },
  db: DatabaseClient = prisma,
) {
  return createSourceDocument(
    context,
    {
      ...input,
      sourceType: "MANUAL_NOTE",
      provenance: {
        kind: "manual_input",
      },
    },
    db,
  );
}

export async function listSourceDocuments(
  context: ScopedContext,
  options: SourceDocumentListOptions,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, options.projectId, "source.read", db);

  const where: Prisma.SourceDocumentWhereInput = {
    orgId: context.orgId,
    projectId: options.projectId,
  };

  if (!options.includeDeleted) {
    where.deletedAt = null;
    where.status = {
      not: "DELETED",
    };
  }

  if (options.sourceType) {
    where.sourceType = options.sourceType;
  }

  if (options.isPrivate !== undefined) {
    where.isPrivate = options.isPrivate;
  }

  const tags = normalizeTags(options.tags);
  if (tags.length > 0) {
    where.tags = {
      hasEvery: tags,
    };
  }

  if (options.createdFrom || options.createdTo) {
    where.createdAt = {
      gte: options.createdFrom,
      lte: options.createdTo,
    };
  }

  const search = options.search?.trim();
  if (search) {
    where.title = {
      contains: search,
      mode: "insensitive",
    };
  }

  return db.sourceDocument.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getSourceDocumentById(
  context: ScopedContext,
  sourceDocumentId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "source.read", db);

  return db.sourceDocument.findFirst({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
    },
  });
}

export async function updateSourceDocument(
  context: ScopedContext,
  sourceDocumentId: string,
  input: SourceDocumentUpdateInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "source.write", db);

  const existing = await db.sourceDocument.findFirstOrThrow({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
    },
    select: {
      projectId: true,
      metadata: true,
    },
  });

  const data: Prisma.SourceDocumentUpdateInput = {};

  if (input.title !== undefined) {
    data.title = input.title;
  }

  if (input.body !== undefined) {
    data.rawText = input.body;
  }

  if (input.rawObjectKey !== undefined) {
    data.rawObjectKey = input.rawObjectKey;
  }

  if (input.metadata !== undefined) {
    data.metadata = mergeMetadata(existing.metadata, input.metadata);
  }

  if (input.tags !== undefined) {
    data.tags = normalizeTags(input.tags);
  }

  if (input.isPrivate !== undefined) {
    data.isPrivate = input.isPrivate;
  }

  if (input.sourceCreatedAt !== undefined) {
    data.sourceCreatedAt = input.sourceCreatedAt;
  }

  const source = await db.sourceDocument.update({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
    },
    data,
  });

  await recordAuditEvent(
    context,
    {
      action: "source.updated",
      entityType: "sourceDocument",
      entityId: source.id,
      projectId: existing.projectId,
    },
    db,
  );

  return source;
}

export async function softDeleteSourceDocument(
  context: ScopedContext,
  sourceDocumentId: string,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertSourcePermission(context, sourceDocumentId, "source.write", db);

  const source = await db.sourceDocument.update({
    where: {
      id: sourceDocumentId,
      orgId: context.orgId,
    },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "source.deleted",
      entityType: "sourceDocument",
      entityId: source.id,
      projectId: source.projectId,
    },
    db,
  );

  return source;
}

export async function selectSourceDocumentsForExtraction(
  context: ScopedContext,
  input: {
    projectId: string;
    sourceIds?: string[];
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "extraction.write", db);

  return db.sourceDocument.findMany({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      id: input.sourceIds ? { in: input.sourceIds } : undefined,
      deletedAt: null,
      status: {
        not: "DELETED",
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export function classifySourceType(provenance?: SourceProvenanceInput): SourceType {
  switch (provenance?.kind) {
    case "file_upload":
      return "FILE_UPLOAD";
    case "github":
      return "GITHUB_COMMIT";
    case "chatgpt":
      return "CHATGPT_EXPORT";
    case "codex":
      return "CODEX_NOTE";
    case "cli":
      return "CLI_SNAPSHOT";
    case "mcp":
      return "MCP_NOTE";
    case "webhook":
      return "WEBHOOK_EVENT";
    case "manual_input":
    default:
      return "MANUAL_NOTE";
  }
}

function buildSourceMetadata(
  metadata?: Record<string, unknown>,
  provenance?: SourceProvenanceInput,
): Prisma.InputJsonObject {
  return {
    ...toInputJsonObject(metadata),
    provenance: {
      kind: provenance?.kind ?? "manual_input",
      externalId: provenance?.externalId,
      externalUrl: provenance?.externalUrl,
      actor: provenance?.actor,
      importedAt: (provenance?.importedAt ?? new Date()).toISOString(),
    },
  };
}

function mergeMetadata(
  existing: Prisma.JsonValue | null,
  incoming: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...toInputJsonObject(existing),
    ...toInputJsonObject(incoming),
  };
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

function toInputJsonObject(value: unknown): Prisma.InputJsonObject {
  return isRecord(value) ? (value as Prisma.InputJsonObject) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
