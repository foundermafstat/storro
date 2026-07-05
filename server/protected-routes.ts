const protectedPathPrefixes = ["/dashboard", "/projects", "/settings", "/api"];
const publicApiPathPrefixes = ["/api/auth", "/api/mcp", "/api/integrations/chatgpt/app", "/api/webhooks", "/api/billing/webhook"];

export function isProtectedPath(pathname: string) {
  if (publicApiPathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  return protectedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
