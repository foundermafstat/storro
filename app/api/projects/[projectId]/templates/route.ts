import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { listTemplateCatalog } from "@/services/template-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const catalog = await listTemplateCatalog(context, {
      projectId,
    });

    return catalog;
  },
});
