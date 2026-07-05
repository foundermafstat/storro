import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createBillingPortal, StripeHttpBillingProvider } from "@/services/billing-service";

const bodySchema = z.object({
  returnUrl: z.string().url().optional(),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const session = await createBillingPortal(
      context,
      {
        returnUrl: body.returnUrl ?? `${env.NEXT_PUBLIC_APP_URL}/settings/billing`,
      },
      new StripeHttpBillingProvider(env.STRIPE_SECRET_KEY),
    );

    return { session };
  },
});
