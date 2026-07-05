import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "@/services/security-headers-service";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const apiLimit = 120;
const apiWindowMs = 60_000;

export default auth((request) => {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const key = `${request.headers.get("x-forwarded-for") ?? "unknown"}:${request.nextUrl.pathname}`;
    const limited = checkLimit(key, Date.now());

    if (limited) {
      return withSecurityHeaders(NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 }));
    }
  }

  return withSecurityHeaders(NextResponse.next());
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

function checkLimit(key: string, now: number) {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + apiWindowMs,
    });
    return false;
  }

  if (bucket.count >= apiLimit) {
    return true;
  }

  bucket.count += 1;
  return false;
}

function withSecurityHeaders(response: NextResponse) {
  applySecurityHeaders(response.headers);

  return response;
}
