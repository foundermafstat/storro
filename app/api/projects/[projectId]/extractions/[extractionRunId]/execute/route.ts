import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { executeExtractionRun } from "@/services/extraction-pipeline-service";
import { ValidationServiceError } from "@/services/errors";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  extractionRunId: z.string().uuid(),
});

const bodySchema = z.object({
  chunkIds: z.array(z.string().uuid()).optional(),
});

const extractionEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_EXTRACTION: z.string().min(1),
  OPENAI_MODEL_GENERATION: z.string().min(1),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { projectId, extractionRunId } = paramsSchema.parse(params);
    const parsedEnv = extractionEnvSchema.safeParse(process.env);

    if (!parsedEnv.success) {
      throw new ValidationServiceError("OpenAI extraction environment is not configured.", {
        issues: parsedEnv.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await executeExtractionRun(
      context,
      {
        extractionRunId,
        projectId,
        chunkIds: body.chunkIds,
      },
      new OpenAiResponsesProvider(parsedEnv.data.OPENAI_API_KEY),
      createAiModelPolicy(parsedEnv.data),
    );

    return result;
  },
});
