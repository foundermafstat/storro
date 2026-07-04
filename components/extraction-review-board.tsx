"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ReviewFact = {
  id: string;
  category: string;
  text: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  isPrivate: boolean;
  confidence: number;
  sourceIds: string[];
};

export function ExtractionReviewBoard({ facts, projectId }: { facts: ReviewFact[]; projectId: string }) {
  const [items, setItems] = useState(facts);

  async function patchFact(factId: string, body: Partial<ReviewFact>) {
    const response = await fetch(`/api/projects/${projectId}/extraction-facts/${factId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    if (payload.ok) {
      setItems((current) => current.map((item) => (item.id === factId ? payload.data.fact : item)));
    }
  }

  return (
    <section className="grid gap-3">
      {items.map((fact) => (
        <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4" key={fact.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={fact.reviewStatus === "APPROVED" ? "success" : fact.reviewStatus === "REJECTED" ? "danger" : "neutral"}>
              {fact.reviewStatus}
            </Badge>
            <Badge variant={fact.isPrivate ? "warning" : "accent"}>{fact.isPrivate ? "Private" : "Public"}</Badge>
            <span className="text-sm text-[color:var(--muted)]">{fact.category} · {Math.round(fact.confidence * 100)}%</span>
          </div>
          <p className="mt-3 text-sm leading-6">{fact.text}</p>
          <p className="mt-2 text-xs text-[color:var(--muted)]">Sources: {fact.sourceIds.join(", ")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => patchFact(fact.id, { reviewStatus: "APPROVED" })} size="sm" variant="secondary">
              Approve
            </Button>
            <Button onClick={() => patchFact(fact.id, { reviewStatus: "REJECTED" })} size="sm" variant="secondary">
              Reject
            </Button>
            <Button onClick={() => patchFact(fact.id, { isPrivate: !fact.isPrivate })} size="sm" variant="secondary">
              Toggle privacy
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
