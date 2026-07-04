"use client";

import { Info } from "lucide-react";
import { codexEvidenceDisclaimer } from "@/services/codex-evidence-service";

export function CodexEvidencePanel() {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-[color:var(--accent)]" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Codex-assisted evidence</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{codexEvidenceDisclaimer}</p>
        </div>
      </div>
    </section>
  );
}
