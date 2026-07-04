"use client";

import { useMemo, useState } from "react";
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

export function ChatGptImportSelector({ projectId }: { projectId: string }) {
  const [rawJson, setRawJson] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");

  const selectedCount = useMemo(() => selectedMessageIds.size, [selectedMessageIds]);

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
        <label className="text-sm font-medium" htmlFor="chatgpt-export-json">
          conversations.json
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
