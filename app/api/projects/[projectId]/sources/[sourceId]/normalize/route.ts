import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { normalizeSourceDocument } from "@/services/source-normalization-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const POST = createApiRoute({
  successStatus: 201,
  handler: async ({ params, request }) => {
    const { projectId, sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    return normalizeSourceDocument(context, {
      sourceDocumentId: sourceId,
      projectId,
    });
  },
});
