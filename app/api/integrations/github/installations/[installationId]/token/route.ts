import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createGitHubAppEnv } from "@/server/env";
import {
  createGitHubInstallationToken,
  GitHubRestAppClient,
} from "@/services/github-app-service";

const paramsSchema = z.object({
  installationId: z.string().regex(/^\d+$/),
});

const bodySchema = z.object({
  repositoryIds: z.array(z.number().int().positive()).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { installationId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createGitHubAppEnv();
    const token = await createGitHubInstallationToken(
      context,
      {
        installationId,
        ...body,
      },
      new GitHubRestAppClient(env),
    );

    return { token };
  },
});
