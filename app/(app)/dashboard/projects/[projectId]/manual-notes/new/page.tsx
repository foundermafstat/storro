import { ManualNoteForm } from "@/components/manual-note-form";

export default async function NewManualNotePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">New manual note</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Daily build notes, lessons, failed attempts, and research context.
      </p>
      <section className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
        <ManualNoteForm projectId={projectId} />
      </section>
    </main>
  );
}
