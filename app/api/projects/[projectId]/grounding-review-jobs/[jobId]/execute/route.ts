import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { executeGroundingReviewJob } from "@/services/grounding-review-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, jobId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await executeGroundingReviewJob(context, {
      projectId,
      jobId,
    });

    return result;
  },
});
