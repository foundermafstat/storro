import { getCurrentAuthContext } from "@/server/auth-context";
import { getMetricsDashboard } from "@/services/observability-service";
import { performanceBudgets } from "@/services/launch-readiness-service";

export default async function LaunchMonitoringPage() {
  const context = await getCurrentAuthContext();
  const metrics = await getMetricsDashboard(context);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Launch Monitoring</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Metric label="API errors" value={String(metrics.api.errors)} />
        <Metric label="API p95 budget" value={`${performanceBudgets.apiP95Ms}ms`} />
        <Metric label="Queue backlog budget" value={String(metrics.alertThresholds.queueBacklogJobs)} />
      </div>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Queue Depth</h2>
        <pre className="mt-3 overflow-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          {JSON.stringify(metrics.queueDepth, null, 2)}
        </pre>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">AI Usage</h2>
        <pre className="mt-3 overflow-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
          {JSON.stringify(metrics.aiUsage, null, 2)}
        </pre>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <p className="text-sm text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
