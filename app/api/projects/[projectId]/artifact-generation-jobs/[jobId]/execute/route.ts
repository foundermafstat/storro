import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { executeArtifactGenerationJob } from "@/services/artifact-generation-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, jobId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const result = await executeArtifactGenerationJob(
      context,
      {
        projectId,
        jobId,
      },
      new OpenAiResponsesProvider(env.OPENAI_API_KEY),
      createAiModelPolicy(env),
    );

    return result;
  },
});
