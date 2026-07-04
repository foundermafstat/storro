import { ChatGptImportSelector } from "@/components/chatgpt-import-selector";

export default async function ChatGptImportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold">ChatGPT export import</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">Official `conversations.json` only.</p>
      <div className="mt-8">
        <ChatGptImportSelector projectId={projectId} />
      </div>
    </main>
  );
}
