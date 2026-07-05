import { createApiRoute } from "@/server/api/route-handler";
import { createGitHubAppEnv } from "@/server/env";
import { handleGitHubWebhook } from "@/services/github-webhook-service";

export const POST = createApiRoute({
  successStatus: 202,
  handler: async ({ request }) => {
    const env = createGitHubAppEnv();
    const rawBody = await request.text();
    const result = await handleGitHubWebhook({
      deliveryId: request.headers.get("x-github-delivery"),
      eventType: request.headers.get("x-github-event"),
      signature256: request.headers.get("x-hub-signature-256"),
      rawBody,
      webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    });

    return result;
  },
});
