import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { redactSourceDocument } from "@/services/redaction-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await redactSourceDocument(context, {
      sourceDocumentId: sourceId,
      projectId,
    });

    return result;
  },
});
