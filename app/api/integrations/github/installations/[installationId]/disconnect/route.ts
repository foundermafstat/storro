import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { disconnectGitHubInstallation } from "@/services/github-app-service";

const paramsSchema = z.object({
  installationId: z.string().regex(/^\d+$/),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { installationId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const installation = await disconnectGitHubInstallation(context, {
      installationId,
    });

    return { installation };
  },
});
