import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { ValidationServiceError } from "@/services/errors";
import { generateDraftFromStoryContext } from "@/services/story-workflow-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  templateId: z.string().min(1).optional(),
  format: z.enum([
    "LONG_ARTICLE",
    "DORAHACKS_UPDATE",
    "GITHUB_RELEASE_NOTES",
    "LINKEDIN_POST",
    "X_THREAD",
    "DAILY_BUILD_JOURNAL",
    "INVESTOR_UPDATE",
    "INTERNAL_CHANGELOG",
    "CUSTOM",
  ]).optional(),
  promptVersion: z.string().optional(),
});

const storyWorkflowEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_EXTRACTION: z.string().min(1),
  OPENAI_MODEL_GENERATION: z.string().min(1),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const parsedEnv = storyWorkflowEnvSchema.safeParse(process.env);

    if (!parsedEnv.success) {
      throw new ValidationServiceError("OpenAI story workflow environment is not configured.", {
        issues: parsedEnv.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    return generateDraftFromStoryContext(
      context,
      {
        ...body,
        projectId,
      },
      new OpenAiResponsesProvider(parsedEnv.data.OPENAI_API_KEY),
      createAiModelPolicy(parsedEnv.data),
    );
  },
});
