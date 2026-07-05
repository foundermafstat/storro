import { describe, expect, it } from "vitest";
import { isProtectedPath } from "@/server/protected-routes";

describe("protected route map", () => {
  it("protects app and API surfaces", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/projects/abc")).toBe(true);
    expect(isProtectedPath("/settings/integrations")).toBe(true);
    expect(isProtectedPath("/api/projects")).toBe(true);
  });

  it("keeps NextAuth API routes public for session flows", () => {
    expect(isProtectedPath("/api/auth/signin")).toBe(false);
  });

  it("keeps MCP public so remote clients can reach token auth", () => {
    expect(isProtectedPath("/api/mcp")).toBe(false);
  });
});
