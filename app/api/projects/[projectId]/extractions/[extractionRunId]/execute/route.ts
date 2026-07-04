import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { executeExtractionRun } from "@/services/extraction-pipeline-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  extractionRunId: z.string().uuid(),
});

const bodySchema = z.object({
  chunkIds: z.array(z.string().uuid()).optional(),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { projectId, extractionRunId } = paramsSchema.parse(params);
    const env = createServerEnv();
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await executeExtractionRun(
      context,
      {
        extractionRunId,
        projectId,
        chunkIds: body.chunkIds,
      },
      new OpenAiResponsesProvider(env.OPENAI_API_KEY),
      createAiModelPolicy(env),
    );

    return result;
  },
});
