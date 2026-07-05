import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { ValidationServiceError } from "@/services/errors";
import { buildGitHubAppInstallUrl } from "@/services/github-app-service";

const querySchema = z.object({
  appSlug: z.string().min(1).optional(),
  state: z.string().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query }) => {
    const appSlug = query.appSlug ?? process.env.GITHUB_APP_SLUG;

    if (!appSlug) {
      throw new ValidationServiceError("GitHub App slug is not configured.");
    }

    return {
      installUrl: buildGitHubAppInstallUrl({
        appSlug,
        state: query.state,
      }),
    };
  },
});
