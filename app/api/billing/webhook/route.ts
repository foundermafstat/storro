import { NextResponse, type NextRequest } from "next/server";
import { createServerEnv } from "@/server/env";
import { handleStripeWebhook } from "@/services/billing-service";

export async function POST(request: NextRequest) {
  const env = createServerEnv();
  const rawBody = await request.text();
  const result = await handleStripeWebhook(
    rawBody,
    request.headers.get("stripe-signature"),
    env.STRIPE_WEBHOOK_SECRET,
  );

  return NextResponse.json({
    ok: true,
    duplicate: result.duplicate,
    deliveryId: result.delivery.id,
  });
}
