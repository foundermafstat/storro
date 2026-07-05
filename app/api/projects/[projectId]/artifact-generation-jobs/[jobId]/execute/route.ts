import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { executeArtifactGenerationJob } from "@/services/artifact-generation-service";
import { ValidationServiceError } from "@/services/errors";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  jobId: z.string().uuid(),
});

const artifactGenerationEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_EXTRACTION: z.string().min(1),
  OPENAI_MODEL_GENERATION: z.string().min(1),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, jobId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const parsedEnv = artifactGenerationEnvSchema.safeParse(process.env);

    if (!parsedEnv.success) {
      throw new ValidationServiceError("OpenAI artifact generation environment is not configured.", {
        issues: parsedEnv.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const result = await executeArtifactGenerationJob(
      context,
      {
        projectId,
        jobId,
      },
      new OpenAiResponsesProvider(parsedEnv.data.OPENAI_API_KEY),
      createAiModelPolicy(parsedEnv.data),
    );

    return result;
  },
});
