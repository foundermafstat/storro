import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createBillingCheckout, StripeHttpBillingProvider } from "@/services/billing-service";

const bodySchema = z.object({
  plan: z.enum(["pro", "team"]),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const priceId = body.plan === "pro" ? env.STRIPE_PRICE_PRO_MONTHLY : env.STRIPE_PRICE_TEAM_MONTHLY;
    const result = await createBillingCheckout(
      context,
      {
        plan: body.plan,
        priceId,
        successUrl: body.successUrl ?? `${env.NEXT_PUBLIC_APP_URL}/settings/billing?checkout=success`,
        cancelUrl: body.cancelUrl ?? `${env.NEXT_PUBLIC_APP_URL}/settings/billing?checkout=cancelled`,
      },
      new StripeHttpBillingProvider(env.STRIPE_SECRET_KEY),
    );

    return result;
  },
});
