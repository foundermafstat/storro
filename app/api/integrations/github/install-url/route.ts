import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { buildGitHubAppInstallUrl } from "@/services/github-app-service";

const querySchema = z.object({
  appSlug: z.string().min(1),
  state: z.string().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query }) => ({
    installUrl: buildGitHubAppInstallUrl(query),
  }),
});
