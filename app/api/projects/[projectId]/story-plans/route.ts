import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
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
    const env = createServerEnv();
    const result = await generateStoryPlan(
      context,
      {
        ...body,
        projectId,
      },
      new OpenAiResponsesProvider(env.OPENAI_API_KEY),
      createAiModelPolicy(env),
    );

    return result;
  },
});
