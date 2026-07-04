import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { enqueueArtifactGeneration } from "@/services/artifact-generation-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  storyRunId: z.string().uuid(),
});

const bodySchema = z.object({
  promptVersion: z.string().optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 202,
  handler: async ({ body, params, request }) => {
    const { projectId, storyRunId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const job = await enqueueArtifactGeneration(context, {
      projectId,
      storyRunId,
      promptVersion: body.promptVersion,
    });

    return { job };
  },
});
