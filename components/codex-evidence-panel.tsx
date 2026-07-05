import { ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codexEvidenceDisclaimer } from "@/services/codex-evidence-service";

export function CodexEvidencePanel() {
  return (
    <section className="grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-[color:var(--accent)]" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">Codex service connection</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{codexEvidenceDisclaimer}</p>
          </div>
        </div>
        <Button asChild variant="primary">
          <a href="/api/mcp" rel="noreferrer" target="_blank">
            <ExternalLink className="size-4" aria-hidden="true" />
            Open MCP tools
          </a>
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
          <div className="font-medium">MCP endpoint</div>
          <div className="mt-1 break-all text-[color:var(--muted)]">/api/mcp</div>
        </div>
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
          <div className="font-medium">Available source tools</div>
          <div className="mt-1 text-[color:var(--muted)]">create_project, list_projects, ingest_research_note, ingest_build_note</div>
        </div>
      </div>
    </section>
  );
}
