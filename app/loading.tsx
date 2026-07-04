export default function Loading() {
  return (
    <main className="min-h-screen bg-[color:var(--background)] p-6">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="h-[calc(100vh-48px)] animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
        <div className="space-y-4">
          <div className="h-16 animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-32 animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
            <div className="h-32 animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
            <div className="h-32 animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
          </div>
          <div className="h-96 animate-pulse rounded-lg bg-[color:var(--surface-alt)]" />
        </div>
      </div>
    </main>
  );
}
