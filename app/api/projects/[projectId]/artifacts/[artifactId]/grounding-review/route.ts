import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { enqueueGroundingReview } from "@/services/grounding-review-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

export const POST = createApiRoute({
  successStatus: 202,
  handler: async ({ params, request }) => {
    const { projectId, artifactId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const job = await enqueueGroundingReview(context, {
      projectId,
      artifactId,
    });

    return { job };
  },
});
