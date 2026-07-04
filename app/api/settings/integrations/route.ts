import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  disconnectGitHubFromSettings,
  enqueueGitHubResync,
  getIntegrationSettings,
} from "@/services/integration-settings-service";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("github_resync"), connectionId: z.string().uuid() }),
  z.object({ action: z.literal("github_disconnect"), installationId: z.string().regex(/^\d+$/) }),
]);

export const GET = createApiRoute({
  handler: async ({ request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const settings = await getIntegrationSettings(context);

    return { settings };
  },
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    if (body.action === "github_resync") {
      return { job: await enqueueGitHubResync(context, body) };
    }

    return { installation: await disconnectGitHubFromSettings(context, body) };
  },
});
