import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getProjectTimeline } from "@/services/timeline-service";

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

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const querySchema = z
  .object({
    view: z.enum(["daily", "weekly"]).optional(),
    mode: z.enum(["private_journal", "public_update"]).optional(),
    sourceType: sourceTypeSchema.optional(),
    includePrivate: z.enum(["true", "false"]).optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    selectedEventIds: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .transform((query) => ({
    ...query,
    selectedEventIds: query.selectedEventIds?.split(",").map((item) => item.trim()).filter(Boolean),
    includePrivate: query.includePrivate ? query.includePrivate === "true" : undefined,
    createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
    createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
  }));

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const timeline = await getProjectTimeline(context, {
      ...query,
      projectId,
    });

    return { timeline };
  },
});
