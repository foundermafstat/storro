import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { parseAndPersistSourceDocument } from "@/services/source-parser-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await parseAndPersistSourceDocument(context, {
      sourceDocumentId: sourceId,
      projectId,
    });

    return result;
  },
});
