import { notFound } from "next/navigation";
import { MarkdownEditor } from "@/components/markdown-editor";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getArtifactEditorView } from "@/services/artifact-editor-service";

export default async function ArtifactEditorPage({
  params,
}: {
  params: Promise<{ projectId: string; artifactId: string }>;
}) {
  const { projectId, artifactId } = await params;
  const context = await getCurrentAuthContext();
  const view = await getArtifactEditorView(context, {
    projectId,
    artifactId,
  }).catch((error) => {
    if (error instanceof Error && error.message === "Artifact not found.") {
      return null;
    }

    throw error;
  });

  if (!view) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold">{view.artifact.title}</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">Markdown editor and revision history.</p>
      </div>
      <div className="mt-8">
        <MarkdownEditor
          artifactId={artifactId}
          exportReady={view.exportReady}
          facts={view.facts}
          groundingReview={view.groundingReview}
          initialMarkdown={view.artifact.contentMarkdown}
          initialPreviewHtml={view.previewHtml}
          projectId={projectId}
          revisions={view.revisions}
        />
      </div>
    </main>
  );
}
