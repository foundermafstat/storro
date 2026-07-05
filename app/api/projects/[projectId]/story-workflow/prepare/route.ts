import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { ValidationServiceError } from "@/services/errors";
import { prepareStoryContext } from "@/services/story-workflow-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const artifactFormatSchema = z.enum([
  "LONG_ARTICLE",
  "DORAHACKS_UPDATE",
  "GITHUB_RELEASE_NOTES",
  "LINKEDIN_POST",
  "X_THREAD",
  "DAILY_BUILD_JOURNAL",
  "INVESTOR_UPDATE",
  "INTERNAL_CHANGELOG",
  "CUSTOM",
]);

const bodySchema = z
  .object({
    selectedSourceIds: z.array(z.string().uuid()).optional(),
    templateId: z.string().min(1).optional(),
    format: artifactFormatSchema.optional(),
    mode: z.enum(["private_journal", "public_update"]).optional(),
    includePrivate: z.boolean().optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .transform((body) => ({
    ...body,
    createdFrom: body.createdFrom ? new Date(body.createdFrom) : undefined,
    createdTo: body.createdTo ? new Date(body.createdTo) : undefined,
  }));

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

    return prepareStoryContext(
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
