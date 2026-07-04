import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { chunkNormalizedSource } from "@/services/source-chunking-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  normalizedSourceId: z.string().uuid(),
});

const bodySchema = z.object({
  maxTokens: z.number().int().min(32).max(8000).optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId, normalizedSourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const chunks = await chunkNormalizedSource(
      context,
      {
        normalizedSourceId,
        projectId,
      },
      {
        maxTokens: body.maxTokens,
      },
    );

    return { chunks };
  },
});
