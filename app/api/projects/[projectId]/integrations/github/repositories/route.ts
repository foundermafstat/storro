import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createGitHubAppEnv } from "@/server/env";
import {
  GitHubRestAppClient,
  listGitHubRepositoryOptionsForProject,
  selectGitHubRepositoriesForProject,
} from "@/services/github-app-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  fullName: z.string().min(1),
  private: z.boolean().optional(),
  htmlUrl: z.string().url().optional(),
});

const bodySchema = z.object({
  installationId: z.string().regex(/^\d+$/),
  repositories: z.array(repositorySchema).min(1),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createGitHubAppEnv();
    const installations = await listGitHubRepositoryOptionsForProject(
      context,
      { projectId },
      new GitHubRestAppClient(env),
    );

    return { installations };
  },
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const connections = await selectGitHubRepositoriesForProject(context, {
      projectId,
      installationId: body.installationId,
      repositories: body.repositories,
    });

    return { connections };
  },
});
