import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { GitHubRestAppClient } from "@/services/github-app-service";
import {
  executeGitHubWriteAction,
  GitHubRestWriteClient,
  listGitHubWriteFeatures,
  prepareGitHubWriteAction,
} from "@/services/github-write-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const querySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
});

const bodySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  owner: z.string().min(1),
  repo: z.string().min(1),
  action: z.enum(["CREATE_RELEASE_DRAFT", "CREATE_PR_COMMENT", "UPSERT_CHANGELOG", "PUBLISH_RELEASE_DRAFT"]),
  releaseTag: z.string().optional(),
  releaseName: z.string().optional(),
  releaseBody: z.string().optional(),
  targetCommitish: z.string().optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  commentBody: z.string().optional(),
  filePath: z.string().optional(),
  fileContent: z.string().optional(),
  commitMessage: z.string().optional(),
  branch: z.string().optional(),
  releaseId: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const features = await listGitHubWriteFeatures(context, {
      projectId,
      installationId: query.installationId,
    });

    return { features };
  },
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    if (body.dryRun) {
      const preview = await prepareGitHubWriteAction(context, {
        ...body,
        projectId,
      });

      return { preview };
    }

    const env = createServerEnv();
    const result = await executeGitHubWriteAction(
      context,
      {
        ...body,
        projectId,
      },
      new GitHubRestAppClient(env),
      (token) => new GitHubRestWriteClient(token),
    );

    return result;
  },
});
