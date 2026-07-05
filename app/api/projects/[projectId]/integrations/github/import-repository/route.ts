import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createGitHubAppEnv } from "@/server/env";
import { GitHubRestAppClient } from "@/services/github-app-service";
import {
  GitHubRestRepositoryClient,
  importGitHubRepository,
} from "@/services/github-repository-import-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  maxCommits: z.number().int().min(1).max(100).optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 202,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createGitHubAppEnv();
    const result = await importGitHubRepository(
      context,
      {
        ...body,
        projectId,
      },
      new GitHubRestAppClient(env),
      (token) => new GitHubRestRepositoryClient(token),
    );

    return result;
  },
});
