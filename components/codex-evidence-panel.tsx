"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Info, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const codexEvidenceDisclaimer =
  "Codex-assisted labels are based on repository evidence selected by the user and optional user notes. Storro does not claim private Codex session access.";

type CodexConnectorState = {
  connectorUrl: string;
  publicHttps: boolean;
  connected: boolean;
  connectedAt: string | null;
  tools: Array<{ name: string; description: string }>;
};

export function CodexEvidencePanel({ projectId }: { projectId: string }) {
  const [connector, setConnector] = useState<CodexConnectorState | null>(null);
  const [status, setStatus] = useState("Loading Codex connector...");
  const [isPending, setIsPending] = useState(false);

  const displayConnectorUrl = useMemo(() => {
    if (!connector) {
      return "Connector URL unavailable.";
    }

    const url = new URL(connector.connectorUrl);
    url.searchParams.set("token", "hidden");

    return url.toString();
  }, [connector]);

  const loadConnector = useCallback(async () => {
    setStatus("Loading Codex connector...");

    const response = await fetch(`/api/integrations/codex/connector?projectId=${projectId}`);
    const payload = await response.json();

    if (!payload.ok) {
      setConnector(null);
      setStatus(payload.error?.message ?? "Codex connector unavailable.");
      return;
    }

    setConnector(payload.data);
    setStatus(payload.data.connected ? "Codex connection saved for this project." : "Ready to connect Codex.");
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConnector();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadConnector]);

  async function copyConnectorUrl() {
    if (!connector) {
      return;
    }

    await navigator.clipboard.writeText(connector.connectorUrl);
    setStatus("Codex connector URL copied.");
  }

  async function connectCodex() {
    setIsPending(true);
    setStatus("Saving Codex connection...");

    try {
      const response = await fetch(`/api/integrations/codex/connector?projectId=${projectId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "connect" }),
      });
      const payload = await response.json();

      if (!payload.ok) {
        setStatus(payload.error?.message ?? "Codex connection failed.");
        return;
      }

      setConnector(payload.data);
      setStatus("Codex connection saved for this project.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 size-4 shrink-0 text-[color:var(--accent)]" aria-hidden="true" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Codex service connection</h2>
              {connector?.publicHttps ? <Badge variant="success">Public HTTPS</Badge> : <Badge variant="warning">Local only</Badge>}
              {connector?.connected ? <Badge variant="accent">Connected</Badge> : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{codexEvidenceDisclaimer}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-[color:var(--foreground)] text-white hover:bg-black [&_*]:text-white"
            disabled={!connector}
            onClick={copyConnectorUrl}
            type="button"
            variant="primary"
          >
            <Copy className="size-4" aria-hidden="true" />
            Copy Codex MCP URL
          </Button>
          <Button disabled={isPending || !connector} onClick={connectCodex} type="button" variant="secondary">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {connector?.connected ? "Reconnect" : "Connect project"}
          </Button>
          <Button disabled={isPending} onClick={loadConnector} type="button" variant="secondary">
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>
      <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <span>{status}</span>
        </div>
        <p className="mt-2 break-all text-[color:var(--muted)]">{displayConnectorUrl}</p>
        {connector?.connectedAt ? (
          <p className="mt-2 text-[color:var(--muted)]">Connected at {new Date(connector.connectedAt).toLocaleString()}</p>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
          <div className="font-medium">MCP endpoint</div>
          <div className="mt-1 break-all text-[color:var(--muted)]">/api/mcp</div>
        </div>
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
          <div className="font-medium">Available Codex tools</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {connector?.tools.length ? connector.tools.map((tool) => <Badge key={tool.name} variant="neutral">{tool.name}</Badge>) : <span className="text-[color:var(--muted)]">Loading tools...</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
