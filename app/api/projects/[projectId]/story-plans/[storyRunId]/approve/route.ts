import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { approveStoryPlan } from "@/services/artifact-generation-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  storyRunId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, storyRunId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const storyRun = await approveStoryPlan(context, {
      projectId,
      storyRunId,
    });

    return { storyRun };
  },
});
