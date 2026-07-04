"use client";

import { useMemo, useState, useTransition } from "react";
import { Clock3, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Revision = {
  id: string;
  contentHash: string;
  groundingState: string;
  createdAt: Date | string;
};

type Fact = {
  id: string;
  category: string;
  text: string;
};

export function MarkdownEditor({
  projectId,
  artifactId,
  initialMarkdown,
  initialPreviewHtml,
  revisions,
  facts,
  groundingReview,
  exportReady,
}: {
  projectId: string;
  artifactId: string;
  initialMarkdown: string;
  initialPreviewHtml: string;
  revisions: Revision[];
  facts: Fact[];
  groundingReview: unknown;
  exportReady: boolean;
}) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [previewHtml, setPreviewHtml] = useState(initialPreviewHtml);
  const [items, setItems] = useState(revisions);
  const [isPending, startTransition] = useTransition();
  const reviewIssues = useMemo(() => readReviewIssues(groundingReview), [groundingReview]);

  function save(saveMode: "autosave" | "manual") {
    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${artifactId}/editor`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ contentMarkdown: markdown, saveMode }),
      });
      const payload = await response.json();

      if (payload.ok) {
        setPreviewHtml(payload.data.previewHtml);
        setItems((current) => [payload.data.revision, ...current]);
      }
    });
  }

  function restore(revisionId: string) {
    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${artifactId}/revisions/${revisionId}/restore`, {
        method: "POST",
      });
      const payload = await response.json();

      if (payload.ok) {
        setMarkdown(payload.data.artifact.contentMarkdown);
        setPreviewHtml(payload.data.previewHtml);
        setItems((current) => [payload.data.revision, ...current]);
      }
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={exportReady ? "success" : "warning"}>{exportReady ? "Export ready" : "Review needed"}</Badge>
            {reviewIssues.length > 0 ? <Badge variant="warning">{reviewIssues.length} grounding warnings</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending} onClick={() => save("autosave")} size="sm" variant="secondary">
              <Clock3 className="size-4" aria-hidden="true" />
              Autosave
            </Button>
            <Button disabled={isPending} onClick={() => save("manual")} size="sm" variant="primary">
              <Save className="size-4" aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <textarea
            aria-label="Markdown editor"
            className="min-h-[520px] resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 font-mono text-sm leading-6 outline-none focus:border-[color:var(--accent)]"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
          />
          <article
            className="min-h-[520px] overflow-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm leading-6"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <h2 className="font-semibold">Revisions</h2>
          <ul className="mt-3 grid gap-2">
            {items.map((revision) => (
              <li className="flex items-center justify-between gap-2 text-sm" key={revision.id}>
                <span className="min-w-0 truncate">{new Date(revision.createdAt).toLocaleString()}</span>
                <Button aria-label="Restore revision" onClick={() => restore(revision.id)} size="icon" variant="ghost">
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
          <h2 className="font-semibold">Source facts</h2>
          <ul className="mt-3 grid gap-3">
            {facts.map((fact) => (
              <li className="text-sm leading-6" key={fact.id}>
                <Badge variant="accent">{fact.category}</Badge>
                <p className="mt-2 text-[color:var(--muted)]">{fact.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function readReviewIssues(value: unknown) {
  if (!value || typeof value !== "object" || !("issues" in value) || !Array.isArray(value.issues)) {
    return [];
  }

  return value.issues;
}
