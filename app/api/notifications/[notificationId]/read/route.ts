import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { markNotificationRead } from "@/services/notification-service";

const paramsSchema = z.object({
  notificationId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { notificationId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const notification = await markNotificationRead(context, {
      notificationId,
    });

    return { notification };
  },
});
