import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createExtractionRun } from "@/services/extraction-pipeline-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  selectedSourceIds: z.array(z.string().uuid()).min(1),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const run = await createExtractionRun(context, {
      ...body,
      projectId,
    });

    return { run };
  },
});
