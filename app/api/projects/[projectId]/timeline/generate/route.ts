import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createAiModelPolicy, OpenAiResponsesProvider } from "@/services/ai-gateway";
import { ValidationServiceError } from "@/services/errors";
import { generateTimelineStoryArtifact } from "@/services/timeline-service";

const sourceTypeSchema = z.enum([
  "MANUAL_NOTE",
  "FILE_UPLOAD",
  "CHATGPT_NOTE",
  "CHATGPT_EXPORT",
  "GIT_DIFF",
  "COMMIT_LOG",
  "GITHUB_COMMIT",
  "GITHUB_PULL_REQUEST",
  "GITHUB_RELEASE",
  "CODEX_NOTE",
  "CLI_SNAPSHOT",
  "MCP_NOTE",
  "WEBHOOK_EVENT",
]);

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    view: z.enum(["daily", "weekly"]).optional(),
    mode: z.enum(["private_journal", "public_update"]).optional(),
    sourceType: sourceTypeSchema.optional(),
    includePrivate: z.boolean().optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
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
  })
  .transform((body) => ({
    ...body,
    createdFrom: body.createdFrom ? new Date(body.createdFrom) : undefined,
    createdTo: body.createdTo ? new Date(body.createdTo) : undefined,
  }));

const timelineGenerationEnvSchema = z.object({
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
    const parsedEnv = timelineGenerationEnvSchema.safeParse(process.env);

    if (!parsedEnv.success) {
      throw new ValidationServiceError("OpenAI timeline generation environment is not configured.", {
        issues: parsedEnv.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const result = await generateTimelineStoryArtifact(
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
