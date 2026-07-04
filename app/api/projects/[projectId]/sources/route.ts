import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  createSourceDocument,
  listSourceDocuments,
} from "@/services/source-service";

const sourceTypeSchema = z.enum([
  "MANUAL_NOTE",
  "FILE_UPLOAD",
  "CHATGPT_NOTE",
  "CHATGPT_EXPORT",
  "GIT_DIFF",
  "COMMIT_LOG",
  "GITHUB_COMMIT",
  "GITHUB_PULL_REQUEST",
  "GITHUB_RELEASE",
  "CODEX_NOTE",
  "CLI_SNAPSHOT",
  "MCP_NOTE",
  "WEBHOOK_EVENT",
]);

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const provenanceSchema = z.object({
  kind: z.enum(["manual_input", "file_upload", "github", "chatgpt", "codex", "cli", "mcp", "webhook"]),
  externalId: z.string().optional(),
  externalUrl: z.string().url().optional(),
  actor: z.string().optional(),
  importedAt: z.string().datetime().optional(),
});

const createSourceSchema = z
  .object({
    title: z.string().min(2).max(200),
    body: z.string().optional(),
    rawObjectKey: z.string().optional(),
    sourceType: sourceTypeSchema.optional(),
    provenance: provenanceSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(40)).max(30).optional(),
    isPrivate: z.boolean().optional(),
    sourceCreatedAt: z.string().datetime().optional(),
  })
  .transform((input) => ({
    ...input,
    sourceCreatedAt: input.sourceCreatedAt ? new Date(input.sourceCreatedAt) : undefined,
    provenance: input.provenance
      ? {
          ...input.provenance,
          importedAt: input.provenance.importedAt ? new Date(input.provenance.importedAt) : undefined,
        }
      : undefined,
  }));

const listSourcesQuerySchema = z
  .object({
    sourceType: sourceTypeSchema.optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    isPrivate: z.enum(["true", "false"]).optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    search: z.string().optional(),
    includeDeleted: z.enum(["true", "false"]).optional(),
  })
  .transform((query) => ({
    sourceType: query.sourceType,
    tags: normalizeQueryTags(query.tags),
    isPrivate: query.isPrivate ? query.isPrivate === "true" : undefined,
    createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
    createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    search: query.search,
    includeDeleted: query.includeDeleted === "true",
  }));

export const GET = createApiRoute({
  querySchema: listSourcesQuerySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const sources = await listSourceDocuments(context, {
      ...query,
      projectId,
    });

    return { sources };
  },
});

export const POST = createApiRoute({
  bodySchema: createSourceSchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const source = await createSourceDocument(context, {
      ...body,
      projectId,
    });

    return { source };
  },
});

function normalizeQueryTags(value: string | string[] | undefined) {
  if (!value) {
    return undefined;
  }

  const tags = Array.isArray(value) ? value : value.split(",");
  return tags.map((tag) => tag.trim()).filter(Boolean);
}
