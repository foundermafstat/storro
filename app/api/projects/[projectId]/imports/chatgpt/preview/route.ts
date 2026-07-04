import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { parseChatGptConversationsExport } from "@/services/chatgpt-export-service";

const previewSchema = z.object({
  rawJson: z.string().min(2),
});

export const POST = createApiRoute({
  bodySchema: previewSchema,
  handler: async ({ body }) => parseChatGptConversationsExport(body.rawJson),
});
