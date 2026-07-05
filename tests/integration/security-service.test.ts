import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import { applySecurityHeaders } from "@/services/security-headers-service";
import {
  assertSecurityRateLimit,
  decryptSecret,
  deleteOrganizationData,
  exportOrganizationData,
  resetSecurityRateLimits,
  storeEncryptedIntegrationToken,
} from "@/services/security-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const encryptionKey = `test-encryption-key-${suffix}`.padEnd(40, "x");

let orgId = "";
let orgSlug = "";
let userId = "";
let context: ScopedContext;

describe("security hardening service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `security-user-${suffix}`, email: `security-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Security Org ${suffix}`, slug: `security-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    orgSlug = org.slug;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("encrypts stored integration tokens at rest", async () => {
    const project = await createProject(context, { name: `Security Project ${suffix}` });
    const connection = await prisma.sourceConnection.create({
      data: {
        orgId,
        projectId: project.id,
        provider: "GITHUB",
        status: "CONNECTED",
        displayName: "secure repo",
      },
    });
    const updated = await storeEncryptedIntegrationToken(context, {
      connectionId: connection.id,
      token: "ghs_plaintext_token",
      encryptionKey,
    });

    expect(updated.encryptedToken).not.toBe("ghs_plaintext_token");
    expect(updated.encryptedToken?.startsWith("v1:")).toBe(true);
    expect(decryptSecret(updated.encryptedToken ?? "", encryptionKey)).toBe("ghs_plaintext_token");
  });

  it("blocks abusive calls with rate limits", () => {
    resetSecurityRateLimits();
    assertSecurityRateLimit("security-test", { limit: 2, windowMs: 60_000, now: 1 });
    assertSecurityRateLimit("security-test", { limit: 2, windowMs: 60_000, now: 2 });

    expect(() => assertSecurityRateLimit("security-test", { limit: 2, windowMs: 60_000, now: 3 })).toThrow("Security rate limit exceeded.");
  });

  it("adds strict security headers", () => {
    const headers = applySecurityHeaders(new Headers());

    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("strict-transport-security")).toContain("max-age=");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("exports and deletes organization data with anonymization", async () => {
    const exportData = await exportOrganizationData(context);
    expect(exportData.counts.projects).toBeGreaterThanOrEqual(1);

    const deletion = await deleteOrganizationData(context, { confirmOrgSlug: orgSlug });
    const organization = await prisma.organization.findUnique({ where: { id: orgId } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(deletion.deletedOrgId).toBe(orgId);
    expect(organization).toBeNull();
    expect(user.email).toBeNull();
    expect(user.name).toBe("Deleted user");
  });
});
