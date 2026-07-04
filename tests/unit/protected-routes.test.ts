import { describe, expect, it } from "vitest";
import { isProtectedPath } from "@/server/protected-routes";

describe("protected route map", () => {
  it("protects app and API surfaces", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/projects/abc")).toBe(true);
    expect(isProtectedPath("/settings/integrations")).toBe(true);
    expect(isProtectedPath("/api/projects")).toBe(true);
  });

  it("keeps Clerk webhook public for signature verification", () => {
    expect(isProtectedPath("/api/webhooks/clerk")).toBe(false);
  });
});
