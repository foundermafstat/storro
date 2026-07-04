import { IntegrationSettingsPanel } from "@/components/integration-settings-panel";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getIntegrationSettings } from "@/services/integration-settings-service";

export default async function IntegrationSettingsPage() {
  const context = await getCurrentAuthContext();
  const settings = await getIntegrationSettings(context);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Integrations</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">Connection state, permissions, sync health, and webhooks.</p>
      <div className="mt-8">
        <IntegrationSettingsPanel settings={settings} />
      </div>
    </main>
  );
}
