import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { upsertNotificationPreference } from "@/services/notification-service";

const notificationTypeSchema = z.enum([
  "EXTRACTION_COMPLETE",
  "GENERATION_COMPLETE",
  "GROUNDING_FAILED",
  "GITHUB_SYNC_FAILED",
  "WEBHOOK_DISCONNECTED",
  "QUOTA_WARNING",
  "BILLING_ISSUE",
  "EXPORT_READY",
]);

const bodySchema = z.object({
  scope: z.enum(["ORG_DEFAULT", "USER"]).default("USER"),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  disabledEmailTypes: z.array(notificationTypeSchema).optional(),
  disabledInAppTypes: z.array(notificationTypeSchema).optional(),
});

export const PATCH = createApiRoute({
  bodySchema,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const preference = await upsertNotificationPreference(context, body);

    return { preference };
  },
});
