import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { ValidationServiceError } from "@/services/errors";
import {
  generateStoryPlan,
  listStoryPlans,
} from "@/services/story-planning-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  templateId: z.string().min(1),
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
  ]),
  audience: z.string().optional(),
  tone: z.string().optional(),
  publicOnly: z.boolean().optional(),
  promptVersion: z.string().optional(),
});

const storyPlanningEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_EXTRACTION: z.string().min(1),
  OPENAI_MODEL_GENERATION: z.string().min(1),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const storyPlans = await listStoryPlans(context, {
      projectId,
    });

    return { storyPlans };
  },
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const parsedEnv = storyPlanningEnvSchema.safeParse(process.env);

    if (!parsedEnv.success) {
      throw new ValidationServiceError("OpenAI story planning environment is not configured.", {
        issues: parsedEnv.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const result = await generateStoryPlan(
      context,
      {
        ...body,
        projectId,
      },
      new OpenAiResponsesProvider(parsedEnv.data.OPENAI_API_KEY),
      createAiModelPolicy(parsedEnv.data),
    );

    return result;
  },
});
