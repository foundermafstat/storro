import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getJobTrace } from "@/services/observability-service";

const paramsSchema = z.object({
  jobId: z.string().uuid(),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { jobId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const trace = await getJobTrace(context, { jobId });

    return { trace };
  },
});
