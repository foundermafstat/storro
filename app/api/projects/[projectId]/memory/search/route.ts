import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { searchProjectMemory } from "@/services/memory-search-service";

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

const querySchema = z
  .object({
    q: z.string().min(2).max(240),
    sourceType: sourceTypeSchema.optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    includePrivate: z.enum(["true", "false"]).optional(),
    retrievalMode: z.enum(["workspace", "public_generation"]).optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    minConfidence: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .transform((query) => ({
    query: query.q,
    sourceType: query.sourceType,
    tags: normalizeQueryTags(query.tags),
    includePrivate: query.includePrivate ? query.includePrivate === "true" : undefined,
    retrievalMode: query.retrievalMode,
    createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
    createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    minConfidence: query.minConfidence,
    limit: query.limit,
  }));

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const memory = await searchProjectMemory(context, {
      ...query,
      projectId,
    });

    return { memory };
  },
});

function normalizeQueryTags(value: string | string[] | undefined) {
  if (!value) {
    return undefined;
  }

  const tags = Array.isArray(value) ? value : value.split(",");
  return tags.map((tag) => tag.trim()).filter(Boolean);
}
