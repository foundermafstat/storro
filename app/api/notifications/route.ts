import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { listInAppNotifications } from "@/services/notification-service";

const querySchema = z
  .object({
    unreadOnly: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((query) => ({
    unreadOnly: query.unreadOnly ? query.unreadOnly === "true" : undefined,
    limit: query.limit,
  }));

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const notifications = await listInAppNotifications(context, query);

    return { notifications };
  },
});
