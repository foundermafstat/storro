import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import {
  GitHubRestAppClient,
  handleGitHubInstallationCallback,
} from "@/services/github-app-service";

const querySchema = z.object({
  installation_id: z.string().regex(/^\d+$/),
  setup_action: z.string().optional(),
  state: z.string().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const installation = await handleGitHubInstallationCallback(
      context,
      {
        installationId: query.installation_id,
        setupAction: query.setup_action,
        state: query.state,
      },
      new GitHubRestAppClient(env),
    );

    return { installation };
  },
});
