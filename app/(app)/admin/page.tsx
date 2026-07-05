import { getCurrentAuthContext } from "@/server/auth-context";
import { getAdminConsole } from "@/services/admin-console-service";

export default async function AdminConsolePage() {
  const context = await getCurrentAuthContext();
  const consoleState = await getAdminConsole(context, { limit: 20 });

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Admin Console</h1>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Subscription</h2>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            {consoleState.subscription ? `${consoleState.subscription.plan} · ${consoleState.subscription.status}` : "No billing record"}
          </p>
        </section>
        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Jobs</h2>
          <p className="mt-3 text-sm text-[color:var(--muted)]">{consoleState.jobs.length} recent jobs</p>
        </section>
        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="mt-3 text-sm text-[color:var(--muted)]">{consoleState.webhookDeliveries.length} recent deliveries</p>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Integration Health</h2>
        <div className="mt-3 grid gap-3">
          {consoleState.integrations.sourceConnections.map((connection) => (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm" key={connection.id}>
              <span className="font-medium">{connection.provider}</span>
              <span className="ml-2 text-[color:var(--muted)]">{connection.displayName ?? connection.externalId} · {connection.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Support-Safe Sources</h2>
        <div className="mt-3 grid gap-3">
          {consoleState.sourceMetadata.map((source) => (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm" key={source.id}>
              <span className="font-medium">{source.title}</span>
              <span className="ml-2 text-[color:var(--muted)]">{source.sourceType} · raw hidden: {String(source.rawContentHidden)}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
