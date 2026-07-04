import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getFactSourceContext } from "@/services/extraction-review-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  factId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, factId, sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    return getFactSourceContext(context, { factId, projectId }, sourceId);
  },
});
