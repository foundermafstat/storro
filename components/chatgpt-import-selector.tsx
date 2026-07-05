"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ParsedMessage = {
  id: string;
  role: string;
  text: string;
  createdAt?: string;
  order: number;
};

type ParsedConversation = {
  id: string;
  title: string;
  messages: ParsedMessage[];
  warnings: string[];
};

type PreviewResult = {
  conversations: ParsedConversation[];
  warnings: string[];
};

type ConnectorState = {
  connectorUrl: string;
  publicHttps: boolean;
  chatGptUrl: string;
  tools: Array<{ name: string; description: string }>;
};

export function ChatGptImportSelector({ projectId }: { projectId: string }) {
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [connector, setConnector] = useState<ConnectorState | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");
  const [connectorStatus, setConnectorStatus] = useState<string>("");

  const selectedCount = useMemo(() => selectedMessageIds.size, [selectedMessageIds]);
  const displayConnectorUrl = useMemo(() => {
    if (!connector) {
      return "Connector URL unavailable.";
    }

    try {
      const url = new URL(connector.connectorUrl);
      url.searchParams.set("token", "hidden");

      return url.toString();
    } catch {
      return "Connector URL configured.";
    }
  }, [connector]);

  const loadConnector = useCallback(async () => {
    setConnectorStatus("Loading connector...");

    try {
      const response = await fetch(`/api/integrations/chatgpt/connector?projectId=${projectId}`);
      const payload = await response.json();

      if (!payload.ok) {
        setConnector(null);
        setConnectorStatus(payload.error?.message ?? "Connector unavailable.");
        return;
      }

      setConnector(payload.data);
      setConnectorStatus(payload.data.publicHttps ? "Ready for ChatGPT." : "Local URL needs an HTTPS tunnel.");
    } catch (error) {
      setConnector(null);
      setConnectorStatus(error instanceof Error ? error.message : "Connector unavailable.");
    }
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
    setConnectorStatus("Connector URL copied.");
  }

  async function previewExport() {
    setStatus("Parsing export...");
    const response = await fetch(`/api/projects/${projectId}/imports/chatgpt/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ rawJson }),
    });
    const payload = await response.json();
    setPreview(payload.ok ? payload.data : null);
    setSelectedConversationIds(new Set());
    setSelectedMessageIds(new Set());
    setStatus(payload.ok ? "Preview ready" : payload.error.message);
  }

  async function importSelection() {
    setStatus("Importing selection...");
    const response = await fetch(`/api/projects/${projectId}/imports/chatgpt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rawJson,
        selectedConversationIds: Array.from(selectedConversationIds),
        selectedMessageIds: Array.from(selectedMessageIds),
        isPrivate: true,
      }),
    });
    const payload = await response.json();
    setStatus(payload.ok ? `Imported ${payload.data.sources.length} source documents` : payload.error.message);
  }

  function toggleConversation(conversation: ParsedConversation, checked: boolean) {
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(conversation.id);
      } else {
        next.delete(conversation.id);
      }
      return next;
    });
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      conversation.messages.forEach((message) => {
        if (checked) {
          next.add(message.id);
        } else {
          next.delete(message.id);
        }
      });
      return next;
    });
  }

  function toggleMessage(conversationId: string, messageId: string, checked: boolean) {
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(conversationId);
      }
      return next;
    });
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">ChatGPT connector</h2>
              {connector?.publicHttps ? (
                <Badge variant="success">Public HTTPS</Badge>
              ) : (
                <Badge variant="warning">Local only</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Add this project-scoped MCP server in ChatGPT Connectors.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!connector} onClick={copyConnectorUrl} type="button" variant="primary">
              <Copy className="size-4" aria-hidden="true" />
              Copy connector URL
            </Button>
            <Button asChild variant="secondary">
              <a href={connector?.chatGptUrl ?? "https://chatgpt.com"} rel="noreferrer" target="_blank">
                <ExternalLink className="size-4" aria-hidden="true" />
                Open ChatGPT
              </a>
            </Button>
            <Button onClick={loadConnector} type="button" variant="secondary">
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {connector?.publicHttps ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
            <span>{connectorStatus}</span>
          </div>
          <p className="mt-2 break-all text-[color:var(--muted)]">{displayConnectorUrl}</p>
        </div>
        {connector?.tools.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {connector.tools.map((tool) => <Badge key={tool.name} variant="neutral">{tool.name}</Badge>)}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <label className="text-sm font-medium" htmlFor="chatgpt-export-json">
          Fallback conversations.json
        </label>
        <textarea
          className="mt-3 min-h-56 w-full resize-y rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 font-mono text-sm focus-visible:outline-[color:var(--accent)]"
          id="chatgpt-export-json"
          onChange={(event) => setRawJson(event.target.value)}
          spellCheck={false}
          value={rawJson}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={!rawJson.trim()} onClick={previewExport}>
            Parse export
          </Button>
          <Button
            disabled={selectedConversationIds.size === 0 || selectedMessageIds.size === 0}
            onClick={importSelection}
            variant="secondary"
          >
            Import selected
          </Button>
          {status ? <span className="text-sm text-[color:var(--muted)]">{status}</span> : null}
        </div>
      </section>

      {preview ? (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">{preview.conversations.length} conversations</Badge>
            <Badge variant={selectedCount > 0 ? "success" : "neutral"}>{selectedCount} messages selected</Badge>
          </div>
          {preview.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {preview.warnings.join(" ")}
            </div>
          ) : null}
          {preview.conversations.map((conversation) => (
            <article
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
              key={conversation.id}
            >
              <label className="flex items-start gap-3">
                <input
                  checked={selectedConversationIds.has(conversation.id)}
                  className="mt-1 size-4"
                  onChange={(event) => toggleConversation(conversation, event.target.checked)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{conversation.title}</span>
                  <span className="mt-1 block text-sm text-[color:var(--muted)]">
                    {conversation.messages.length} messages
                  </span>
                </span>
              </label>
              <div className="mt-4 grid gap-2">
                {conversation.messages.map((message) => (
                  <label className="flex items-start gap-3 rounded-md border border-[color:var(--border)] p-3" key={message.id}>
                    <input
                      checked={selectedMessageIds.has(message.id)}
                      className="mt-1 size-4"
                      onChange={(event) => toggleMessage(conversation.id, message.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <Badge variant={message.role === "assistant" ? "success" : "neutral"}>{message.role}</Badge>
                      <span className="mt-2 block truncate text-sm">{message.text}</span>
                    </span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
