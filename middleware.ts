import { NextResponse, type NextRequest } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const apiLimit = 120;
const apiWindowMs = 60_000;

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const key = `${request.headers.get("x-forwarded-for") ?? "unknown"}:${request.nextUrl.pathname}`;
    const limited = checkLimit(key, Date.now());

    if (limited) {
      return withSecurityHeaders(NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429 }));
    }
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
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
  response.headers.set("content-security-policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "));
  response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

  return response;
}
