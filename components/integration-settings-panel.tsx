"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Status = "CONNECTED" | "PENDING" | "ERROR" | "DISCONNECTED" | string;

type ConnectionHealth = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  status: Status;
  displayName: string | null;
  externalId: string | null;
  lastSyncedAt: string | null;
  lastError?: Record<string, unknown>;
  actionableCopy?: string;
};

type IntegrationAccount = {
  id: string;
  status: Status;
  displayName: string | null;
  externalId: string | null;
  lastSyncedAt: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

type IntegrationSettings = {
  github: Array<{
    id: string;
    installationId: string;
    accountLogin: string;
    status: Status;
    permissions: unknown;
    lastSyncedAt: string | null;
    connections: ConnectionHealth[];
  }>;
  chatgpt: IntegrationAccount[];
  codexAction: ConnectionHealth[];
  cli: ConnectionHealth[];
  openai: IntegrationAccount[];
  objectStorage: IntegrationAccount[];
  openaiUsage: Record<string, { quantity: number; events: number }>;
  webhooks: {
    eventType: string;
    status: string;
    signatureValid: boolean;
    error: string | null;
    processedAt: string | null;
    createdAt: string;
  } | null;
  audit: AuditEntry[];
};

export function IntegrationSettingsPanel({ settings }: { settings: IntegrationSettings }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(payload: { action: "github_resync"; connectionId: string } | { action: "github_disconnect"; installationId: string }) {
    startTransition(async () => {
      setMessage(null);
      const response = await fetch("/api/settings/integrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessage(typeof body.error === "string" ? body.error : "Integration action failed.");
        return;
      }

      setMessage("Integration updated.");
      router.refresh();
    });
  }

  async function openGitHubInstall() {
    setMessage(null);
    const response = await fetch("/api/integrations/github/install-url");
    const payload = await response.json();

    if (!payload.ok) {
      setMessage(payload.error?.message ?? "GitHub install failed.");
      return;
    }

    window.location.assign(payload.data.installUrl);
  }

  return (
    <section className="grid gap-6">
      {message ? <p className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] px-3 py-2 text-sm">{message}</p> : null}

      <IntegrationSection title="GitHub">
        <div>
          <Button disabled={isPending} onClick={openGitHubInstall} size="sm" type="button" variant="primary">
            <ExternalLink className="size-4" aria-hidden="true" />
            Install GitHub App
          </Button>
        </div>
        {settings.github.length ? settings.github.map((installation) => (
          <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4" key={installation.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(installation.status)}>{installation.status}</Badge>
                <span className="font-medium">{installation.accountLogin}</span>
                <span className="text-sm text-[color:var(--muted)]">#{installation.installationId}</span>
              </div>
              <Button
                disabled={isPending || installation.status === "DISCONNECTED"}
                onClick={() => runAction({ action: "github_disconnect", installationId: installation.installationId })}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Unplug className="size-4" aria-hidden="true" />
                Disconnect
              </Button>
            </div>
            <div className="mt-3 grid gap-1 text-sm text-[color:var(--muted)]">
              <p>Last sync: {formatDate(installation.lastSyncedAt)}</p>
              <p>Permissions: {formatPermissions(installation.permissions)}</p>
            </div>
            <div className="mt-4 grid gap-3">
              {installation.connections.length ? installation.connections.map((connection) => (
                <ConnectionRow
                  connection={connection}
                  isPending={isPending}
                  key={connection.id}
                  onResync={() => runAction({ action: "github_resync", connectionId: connection.id })}
                />
              )) : <EmptyLine>No mapped repositories</EmptyLine>}
            </div>
          </article>
        )) : <EmptyLine>No GitHub installation connected</EmptyLine>}
      </IntegrationSection>

      <IntegrationSection title="ChatGPT App">
        <div>
          <Button asChild size="sm" variant="primary">
            <a href="/api/integrations/chatgpt/app" rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" aria-hidden="true" />
              Open manifest
            </a>
          </Button>
        </div>
        {settings.chatgpt.length ? settings.chatgpt.map((account) => <IntegrationRow item={account} key={account.id} />) : <EmptyLine>Not connected</EmptyLine>}
      </IntegrationSection>

      <IntegrationSection title="Codex Action">
        <div>
          <Button asChild size="sm" variant="primary">
            <a href="/api/mcp" rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" aria-hidden="true" />
              Open MCP tools
            </a>
          </Button>
        </div>
        {settings.codexAction.length ? settings.codexAction.map((connection) => <ConnectionRow connection={connection} isPending={isPending} key={connection.id} />) : <EmptyLine>No action sources</EmptyLine>}
      </IntegrationSection>

      <IntegrationSection title="CLI">
        {settings.cli.length ? settings.cli.map((connection) => <ConnectionRow connection={connection} isPending={isPending} key={connection.id} />) : <EmptyLine>No CLI snapshots</EmptyLine>}
      </IntegrationSection>

      <div className="grid gap-6 md:grid-cols-2">
        <IntegrationSection title="OpenAI">
          {settings.openai.length ? settings.openai.map((account) => <IntegrationRow item={account} key={account.id} />) : <EmptyLine>Configured by environment</EmptyLine>}
          <UsageSummary usage={settings.openaiUsage} />
        </IntegrationSection>

        <IntegrationSection title="Object Storage">
          {settings.objectStorage.length ? settings.objectStorage.map((account) => <IntegrationRow item={account} key={account.id} />) : <EmptyLine>Configured by environment</EmptyLine>}
        </IntegrationSection>
      </div>

      <IntegrationSection title="Webhooks">
        {settings.webhooks ? (
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={settings.webhooks.status === "FAILED" ? "danger" : "success"}>{settings.webhooks.status}</Badge>
              <span>{settings.webhooks.eventType}</span>
              <span className="text-[color:var(--muted)]">{formatDate(settings.webhooks.processedAt ?? settings.webhooks.createdAt)}</span>
            </div>
            <p className="mt-2 text-[color:var(--muted)]">Signature: {settings.webhooks.signatureValid ? "valid" : "invalid"}</p>
            {settings.webhooks.error ? <p className="mt-2 text-[color:var(--danger)]">{settings.webhooks.error}</p> : null}
          </div>
        ) : <EmptyLine>No webhook deliveries</EmptyLine>}
      </IntegrationSection>

      <IntegrationSection title="Audit History">
        <div className="grid gap-2">
          {settings.audit.length ? settings.audit.map((entry) => (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm" key={entry.id}>
              <span className="font-medium">{entry.action}</span>
              <span className="ml-2 text-[color:var(--muted)]">{entry.entityType} · {formatDate(entry.createdAt)}</span>
            </div>
          )) : <EmptyLine>No audit events</EmptyLine>}
        </div>
      </IntegrationSection>
    </section>
  );
}

function ConnectionRow({ connection, isPending, onResync }: { connection: ConnectionHealth; isPending: boolean; onResync?: () => void }) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-alt)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(connection.status)}>{connection.status}</Badge>
            <span className="font-medium">{connection.displayName ?? connection.externalId}</span>
          </div>
          <p className="text-[color:var(--muted)]">Project: {connection.projectName ?? "organization-wide"} · Last sync: {formatDate(connection.lastSyncedAt)}</p>
        </div>
        {onResync ? (
          <Button disabled={isPending || connection.status === "DISCONNECTED"} onClick={onResync} size="sm" type="button" variant="secondary">
            <RefreshCw className="size-4" aria-hidden="true" />
            Resync
          </Button>
        ) : null}
      </div>
      {connection.actionableCopy ? <p className="mt-2 text-[color:var(--danger)]">{connection.actionableCopy}</p> : null}
    </div>
  );
}

function IntegrationSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function IntegrationRow({ item }: { item: IntegrationAccount }) {
  return (
    <article className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
        <span>{item.displayName ?? item.externalId ?? "Environment account"}</span>
      </div>
      <p className="mt-2 text-[color:var(--muted)]">Last sync: {formatDate(item.lastSyncedAt)}</p>
    </article>
  );
}

function UsageSummary({ usage }: { usage: Record<string, { quantity: number; events: number }> }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-sm">
      <div className="grid gap-2">
        {["AI_EXTRACTION", "AI_GENERATION", "STORAGE_BYTES"].map((type) => (
          <div className="flex items-center justify-between gap-4" key={type}>
            <span>{type}</span>
            <span className="text-[color:var(--muted)]">{usage[type]?.quantity ?? 0} / {usage[type]?.events ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--muted)]">{children}</p>;
}

function statusVariant(status: Status) {
  if (status === "CONNECTED") {
    return "success";
  }
  if (status === "ERROR") {
    return "danger";
  }
  if (status === "PENDING") {
    return "warning";
  }
  return "neutral";
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

function formatPermissions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "none";
  }

  const entries = Object.entries(value).filter(([, permission]) => typeof permission === "string");
  return entries.length ? entries.map(([scope, permission]) => `${scope}:${permission}`).join(", ") : "none";
}
