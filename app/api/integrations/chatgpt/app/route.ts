import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  chatGptAppManifest,
  connectChatGptApp,
  ingestSelectedChatGptContext,
} from "@/services/chatgpt-app-service";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect"),
    externalId: z.string().min(1),
    displayName: z.string().optional(),
  }),
  z.object({
    action: z.literal("ingest_selected_context"),
    projectId: z.string().uuid(),
    title: z.string().min(1),
    selectedText: z.string().min(1),
    sourceUrl: z.string().url().optional(),
  }),
]);

export const GET = createApiRoute({
  handler: async ({ request }) => ({
    manifest: chatGptAppManifest(process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin),
  }),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    if (body.action === "connect") {
      return { integration: await connectChatGptApp(context, body) };
    }

    return { source: await ingestSelectedChatGptContext(context, body) };
  },
});
