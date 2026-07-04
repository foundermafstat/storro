import { CodexEvidencePanel } from "@/components/codex-evidence-panel";

export default async function CodexEvidencePage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Codex evidence</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">User-mark repository evidence as Codex-assisted.</p>
      <div className="mt-8">
        <CodexEvidencePanel />
      </div>
    </main>
  );
}
