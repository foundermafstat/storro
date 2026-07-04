import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { archiveProject } from "@/services/project-service";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const project = await archiveProject(context, projectId);

    return { project };
  },
});
