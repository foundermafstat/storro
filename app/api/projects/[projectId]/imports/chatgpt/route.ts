import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { importSelectedChatGptConversations } from "@/services/chatgpt-export-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const importSchema = z.object({
  rawJson: z.string().min(2),
  selectedConversationIds: z.array(z.string().min(1)).min(1),
  selectedMessageIds: z.array(z.string().min(1)).optional(),
  isPrivate: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
});

export const POST = createApiRoute({
  bodySchema: importSchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    return importSelectedChatGptConversations(context, {
      ...body,
      projectId,
    });
  },
});
