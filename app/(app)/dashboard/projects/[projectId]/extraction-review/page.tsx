import { ExtractionReviewBoard } from "@/components/extraction-review-board";
import { getCurrentAuthContext } from "@/server/auth-context";
import { listExtractionFacts } from "@/services/extraction-review-service";

export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const context = await getCurrentAuthContext();
  const facts = await listExtractionFacts(context, { projectId });

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Extraction review</h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">Approve, reject, and mark facts private before generation.</p>
      <div className="mt-8">
        <ExtractionReviewBoard
          facts={facts.map((fact) => ({
            id: fact.id,
            category: fact.category,
            text: fact.text,
            reviewStatus: fact.reviewStatus,
            isPrivate: fact.isPrivate,
            confidence: fact.confidence,
            sourceIds: fact.sourceIds,
          }))}
          projectId={projectId}
        />
      </div>
    </main>
  );
}
