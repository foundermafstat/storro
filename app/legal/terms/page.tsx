export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Terms of Service</h1>
      <p className="mt-4 text-sm text-[color:var(--muted)]">
        Storro is a commercial product for transforming user-provided project evidence into grounded communications. Users are responsible for source rights, integration access, and reviewing generated artifacts before publication.
      </p>
      <h2 className="mt-8 text-xl font-semibold">Billing</h2>
      <p className="mt-3 text-sm text-[color:var(--muted)]">
        Paid plans use Stripe Billing. Usage quotas are enforced server-side by organization plan.
      </p>
    </main>
  );
}
