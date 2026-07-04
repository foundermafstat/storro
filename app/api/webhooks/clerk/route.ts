import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { syncClerkWebhookEvent } from "@/services/clerk-sync-service";

export async function POST(request: NextRequest) {
  try {
    const event = await verifyWebhook(request);
    await syncClerkWebhookEvent(event);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Clerk webhook verification or sync failed", error);

    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }
}
