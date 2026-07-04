import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { GitHubRestAppClient } from "@/services/github-app-service";
import {
  importGitHubPullRequests,
  listGitHubPullRequestsForSelection,
  GitHubRestPullRequestClient,
} from "@/services/github-pull-request-import-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const querySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  updatedSince: z.string().optional(),
});

const bodySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  owner: z.string().min(1),
  repo: z.string().min(1),
  pullRequestNumbers: z.array(z.number().int().positive()).min(1),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const pullRequests = await listGitHubPullRequestsForSelection(
      context,
      {
        ...query,
        projectId,
      },
      new GitHubRestAppClient(env),
      (token) => new GitHubRestPullRequestClient(token),
    );

    return { pullRequests };
  },
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const result = await importGitHubPullRequests(
      context,
      {
        ...body,
        projectId,
      },
      new GitHubRestAppClient(env),
      (token) => new GitHubRestPullRequestClient(token),
    );

    return result;
  },
});
