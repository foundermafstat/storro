export type LoadTestReport = {
  apiP95Ms: number;
  queueWaitP95Ms: number;
  errorRatePercent: number;
};

export type AccessibilityReport = {
  checkedPages: string[];
  violations: Array<{ page: string; rule: string; severity: "minor" | "major" | "critical" }>;
};

export const performanceBudgets = {
  apiP95Ms: 500,
  queueWaitP95Ms: 30_000,
  errorRatePercent: 1,
  dashboardLcpMs: 2_500,
  editorInputLatencyMs: 100,
};

export const launchChecklistItems = [
  "load_test_passed",
  "accessibility_passed",
  "privacy_terms_hooks",
  "retention_deletion_flow",
  "support_workflow",
  "onboarding_checklist",
  "pricing_gate_validation",
  "final_security_review",
  "launch_monitoring_dashboard",
];

export function evaluateLoadTest(report: LoadTestReport) {
  const blockers = [];

  if (report.apiP95Ms > performanceBudgets.apiP95Ms) {
    blockers.push(`API p95 ${report.apiP95Ms}ms exceeds ${performanceBudgets.apiP95Ms}ms.`);
  }
  if (report.queueWaitP95Ms > performanceBudgets.queueWaitP95Ms) {
    blockers.push(`Queue wait p95 ${report.queueWaitP95Ms}ms exceeds ${performanceBudgets.queueWaitP95Ms}ms.`);
  }
  if (report.errorRatePercent > performanceBudgets.errorRatePercent) {
    blockers.push(`Error rate ${report.errorRatePercent}% exceeds ${performanceBudgets.errorRatePercent}%.`);
  }

  return {
    passed: blockers.length === 0,
    blockers,
    report,
    budgets: performanceBudgets,
  };
}

export function evaluateAccessibility(report: AccessibilityReport) {
  const blockers = report.violations.filter((violation) => violation.severity === "critical");

  return {
    passed: blockers.length === 0,
    blockers,
    report,
  };
}

export function buildLaunchReadiness(input: {
  loadTest: ReturnType<typeof evaluateLoadTest>;
  accessibility: ReturnType<typeof evaluateAccessibility>;
  privacyTermsHooks: boolean;
  retentionDeletionFlow: boolean;
  supportWorkflow: boolean;
  onboardingChecklist: boolean;
  pricingGateValidation: boolean;
  finalSecurityReview: boolean;
  launchMonitoringDashboard: boolean;
}) {
  const checks = {
    load_test_passed: input.loadTest.passed,
    accessibility_passed: input.accessibility.passed,
    privacy_terms_hooks: input.privacyTermsHooks,
    retention_deletion_flow: input.retentionDeletionFlow,
    support_workflow: input.supportWorkflow,
    onboarding_checklist: input.onboardingChecklist,
    pricing_gate_validation: input.pricingGateValidation,
    final_security_review: input.finalSecurityReview,
    launch_monitoring_dashboard: input.launchMonitoringDashboard,
  };
  const blockers = launchChecklistItems.filter((item) => !checks[item as keyof typeof checks]);

  return {
    ready: blockers.length === 0,
    blockers,
    checks,
  };
}
