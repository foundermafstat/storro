export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-4 text-sm text-[color:var(--muted)]">
        Storro stores project sources, generated artifacts, integration metadata, billing records, and audit logs to provide the product. Organization admins can export or delete organization data from security controls.
      </p>
      <h2 className="mt-8 text-xl font-semibold">Data Controls</h2>
      <p className="mt-3 text-sm text-[color:var(--muted)]">
        Private source content is scoped to the organization and is not exposed in support views unless privileged access is explicitly granted and audited.
      </p>
    </main>
  );
}
