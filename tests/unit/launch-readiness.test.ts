import { access, readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildLaunchReadiness,
  evaluateAccessibility,
  evaluateLoadTest,
  launchChecklistItems,
  performanceBudgets,
} from "@/services/launch-readiness-service";

describe("launch readiness", () => {
  it("passes load test budgets when latency and errors are within targets", () => {
    const result = evaluateLoadTest({
      apiP95Ms: performanceBudgets.apiP95Ms,
      queueWaitP95Ms: 1_000,
      errorRatePercent: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("fails load test budgets on slow API latency", () => {
    const result = evaluateLoadTest({
      apiP95Ms: performanceBudgets.apiP95Ms + 1,
      queueWaitP95Ms: 1_000,
      errorRatePercent: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.blockers[0]).toContain("API p95");
  });

  it("passes accessibility when core pages have no critical violations", () => {
    const result = evaluateAccessibility({
      checkedPages: ["/dashboard", "/admin/launch"],
      violations: [],
    });

    expect(result.passed).toBe(true);
  });

  it("builds a complete launch checklist with no blockers", () => {
    const ready = buildLaunchReadiness({
      loadTest: evaluateLoadTest({ apiP95Ms: 200, queueWaitP95Ms: 1_000, errorRatePercent: 0 }),
      accessibility: evaluateAccessibility({ checkedPages: ["/dashboard"], violations: [] }),
      privacyTermsHooks: true,
      retentionDeletionFlow: true,
      supportWorkflow: true,
      onboardingChecklist: true,
      pricingGateValidation: true,
      finalSecurityReview: true,
      launchMonitoringDashboard: true,
    });

    expect(ready.ready).toBe(true);
    expect(ready.blockers).toEqual([]);
    expect(Object.keys(ready.checks)).toEqual(launchChecklistItems);
  });

  it("ships legal hooks and launch documents", async () => {
    await expect(access("app/legal/privacy/page.tsx")).resolves.toBeUndefined();
    await expect(access("app/legal/terms/page.tsx")).resolves.toBeUndefined();
    await expect(access("docs/launch/launch-checklist.md")).resolves.toBeUndefined();
    await expect(access("docs/launch/final-security-review.md")).resolves.toBeUndefined();
    await expect(access("docs/operations/support-workflow.md")).resolves.toBeUndefined();

    const checklist = await readFile("docs/launch/launch-checklist.md", "utf8");
    expect(checklist).toContain("No critical implementation blockers");
  });
});
