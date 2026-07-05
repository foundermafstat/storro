"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  FilePenLine,
  GitCommitHorizontal,
  GitPullRequest,
  Layers3,
  MessageSquareText,
  Play,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SourceRow = {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  isPrivate: boolean;
  sourceCreatedAt: string;
  parsedAt: string | null;
  normalizedCount: number;
  chunkCount: number;
  redactionBlocked: boolean | null;
};

type ExtractionRunRow = {
  id: string;
  status: string;
  selectedSourceIds: string[];
  createdAt: string;
  errorMessage: string | null;
};

type StoryRunRow = {
  id: string;
  status: string;
  templateId: string;
  format: string;
  hasPlan: boolean;
  createdAt: string;
  errorMessage: string | null;
};

type ArtifactRow = {
  id: string;
  title: string;
  format: string;
  status: string;
  groundingState: string;
  createdAt: string;
};

type GenerationJobRow = {
  id: string;
  status: string;
  createdAt: string;
  error: string | null;
};

type TemplateOption = {
  id: string;
  name: string;
  format: string;
  available: boolean;
};

type TimelineEventRow = {
  id: string;
  entityType: string;
  eventType: string;
  title: string;
  summary: string;
  sourceType: string | null;
  isPrivate: boolean;
  occurredAt: string;
};

type TimelineDayRow = {
  date: string;
  events: TimelineEventRow[];
};

type GitHubImportTarget = {
  installationId: string;
  owner: string;
  repo: string;
  branch?: string;
};

type FactCounts = {
  pending: number;
  approved: number;
  rejected: number;
  privateFacts: number;
};

type ApiResponse<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: { message: string } };

export function ProjectWorkflowPanel({
  approvedFactCount,
  artifacts,
  extractionRuns,
  factCounts,
  generationJobs,
  githubImportTarget,
  projectId,
  sources,
  storyRuns,
  templates,
  timeline,
}: {
  approvedFactCount: number;
  artifacts: ArtifactRow[];
  extractionRuns: ExtractionRunRow[];
  factCounts: FactCounts;
  generationJobs: GenerationJobRow[];
  githubImportTarget: GitHubImportTarget | null;
  projectId: string;
  sources: SourceRow[];
  storyRuns: StoryRunRow[];
  templates: TemplateOption[];
  timeline: TimelineDayRow[];
}) {
  const router = useRouter();
  const [selectedSourceIds, setSelectedSourceIds] = useState(() => new Set(sources.map((source) => source.id)));
  const defaultTemplate = templates.find((item) => item.id === "long-article" && item.available) ?? templates.find((item) => item.available);
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplate?.id ?? "");
  const [queuedExtractionRunId, setQueuedExtractionRunId] = useState<string | null>(null);
  const [queuedGenerationJobId, setQueuedGenerationJobId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const normalizedChunkCount = sources.reduce((total, source) => total + source.chunkCount, 0);
  const runnableExtractionRunId =
    normalizedChunkCount > 0 ? queuedExtractionRunId ?? extractionRuns.find((run) => run.status === "QUEUED")?.id ?? null : null;
  const runnableGenerationJobId =
    queuedGenerationJobId ?? generationJobs.find((job) => job.status === "QUEUED")?.id ?? null;
  const selectedSourceCount = selectedSourceIds.size;
  const timelineEventCount = timeline.reduce((total, day) => total + day.events.length, 0);
  const timelineDates = timeline.map((day) => day.date);
  const timelineRange = timelineDates.length > 0 ? `${timelineDates[timelineDates.length - 1]} - ${timelineDates[0]}` : "No timeline yet";
  const connectedLabels = [
    sources.some((source) => source.sourceType.startsWith("CHATGPT")) ? "ChatGPT" : null,
    sources.some((source) => source.sourceType.startsWith("GITHUB")) ? "GitHub" : null,
    sources.some((source) => source.sourceType === "CODEX_NOTE") ? "Codex" : null,
    sources.some((source) => source.sourceType === "MANUAL_NOTE") ? "Manual" : null,
  ].filter(Boolean);
  const readiness = factCounts.pending > 0
    ? "Review evidence"
    : factCounts.approved > 0
      ? "Ready for draft"
      : sources.length > 0
        ? "Prepare context"
        : "Add context";

  function toggleSource(sourceId: string, checked: boolean) {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(sourceId);
      } else {
        next.delete(sourceId);
      }
      return next;
    });
  }

  async function postJson<TData>(actionKey: string, url: string, body?: unknown) {
    setPendingAction(actionKey);
    setStatus("Running...");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json()) as ApiResponse<TData>;

      if (!payload.ok) {
        setStatus(payload.error.message);
        return null;
      }

      setStatus("Done");
      router.refresh();
      return payload.data;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed.");
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function prepareSource(sourceId: string, step: "parse" | "redact" | "normalize") {
    await postJson(
      `${step}:${sourceId}`,
      `/api/projects/${projectId}/sources/${sourceId}/${step}`,
    );
  }

  async function queueExtraction() {
    const data = await postJson<{ run: { id: string } }>("queue-extraction", `/api/projects/${projectId}/extractions`, {
      selectedSourceIds: Array.from(selectedSourceIds),
    });

    if (data) {
      setQueuedExtractionRunId(data.run.id);
      setStatus("Extraction queued");
    }
  }

  async function runExtraction() {
    if (!runnableExtractionRunId) {
      return;
    }

    await postJson(
      `run-extraction:${runnableExtractionRunId}`,
      `/api/projects/${projectId}/extractions/${runnableExtractionRunId}/execute`,
      {},
    );
  }

  async function generateStoryPlan() {
    if (!selectedTemplate) {
      return;
    }

    await postJson("generate-story-plan", `/api/projects/${projectId}/story-plans`, {
      templateId: selectedTemplate.id,
      format: selectedTemplate.format,
    });
  }

  async function approveStoryPlan(storyRunId: string) {
    await postJson(
      `approve-story:${storyRunId}`,
      `/api/projects/${projectId}/story-plans/${storyRunId}/approve`,
      {},
    );
  }

  async function enqueueArtifact(storyRunId: string) {
    const data = await postJson<{ job: { id: string } }>(
      `enqueue-artifact:${storyRunId}`,
      `/api/projects/${projectId}/story-plans/${storyRunId}/generate`,
      {},
    );

    if (data) {
      setQueuedGenerationJobId(data.job.id);
      setStatus("Artifact generation queued");
    }
  }

  async function runArtifactJob() {
    if (!runnableGenerationJobId) {
      return;
    }

    await postJson(
      `run-artifact:${runnableGenerationJobId}`,
      `/api/projects/${projectId}/artifact-generation-jobs/${runnableGenerationJobId}/execute`,
      {},
    );
  }

  async function prepareStoryContext() {
    const data = await postJson<{ factCounts: FactCounts; nextStep: string }>(
      "prepare-story-context",
      `/api/projects/${projectId}/story-workflow/prepare`,
      {
        selectedSourceIds: Array.from(selectedSourceIds),
        templateId: selectedTemplate?.id,
        format: selectedTemplate?.format,
        mode: selectedTemplate?.format === "LONG_ARTICLE" ? "public_update" : "private_journal",
        includePrivate: selectedTemplate?.format !== "LONG_ARTICLE",
      },
    );

    if (data) {
      setStatus(data.nextStep === "review_evidence" ? "Context prepared. Review evidence before draft." : "Story context ready.");
    }
  }

  async function generateDraft() {
    if (!selectedTemplate) {
      return;
    }

    await postJson("generate-draft", `/api/projects/${projectId}/story-workflow/generate`, {
      templateId: selectedTemplate.id,
      format: selectedTemplate.format,
    });
  }

  async function importRecentGitHubCommits() {
    if (!githubImportTarget) {
      return;
    }

    await postJson("github-import-recent", `/api/projects/${projectId}/integrations/github/import-repository`, {
      ...githubImportTarget,
      maxCommits: 20,
    });
  }

  return (
    <section className="mt-8 grid gap-6">
      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Story flow</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Select context, prepare a timeline, review evidence, then generate the draft.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/manual-notes/new`}>
                <FilePenLine className="size-4" aria-hidden="true" />
                Manual note
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/imports/chatgpt`}>
                <UploadCloud className="size-4" aria-hidden="true" />
                ChatGPT App
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/integrations/github/pull-requests`}>
                <GitPullRequest className="size-4" aria-hidden="true" />
                GitHub PRs
              </Link>
            </Button>
            <Button
              disabled={!githubImportTarget || pendingAction === "github-import-recent"}
              onClick={importRecentGitHubCommits}
              size="sm"
              variant="secondary"
            >
              <GitCommitHorizontal className="size-4" aria-hidden="true" />
              Recent commits
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/codex-evidence`}>
                <Bot className="size-4" aria-hidden="true" />
                Codex MCP
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[
            { title: "Connected context", detail: connectedLabels.length > 0 ? connectedLabels.join(", ") : "No sources yet", done: connectedLabels.length > 0 },
            { title: "Timeline range", detail: timelineRange, done: timelineEventCount > 0 },
            { title: "Evidence", detail: `${factCounts.approved} approved / ${factCounts.pending} pending`, done: factCounts.approved > 0 && factCounts.pending === 0 },
            { title: "Readiness", detail: readiness, done: readiness === "Ready for draft" },
          ].map((step) => (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)] p-3" key={step.title}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{step.title}</p>
                <Badge variant={step.done ? "success" : "neutral"}>{step.done ? "Ready" : "Open"}</Badge>
              </div>
              <p className="mt-2 text-xs text-[color:var(--muted)]">{step.detail}</p>
            </div>
          ))}
        </div>
        {status ? <p className="mt-4 text-sm text-[color:var(--muted)]">{status}</p> : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="flex flex-col gap-3 border-b border-[color:var(--border)] p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold">1. Select context</h3>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{selectedSourceCount} selected timeline inputs</p>
            </div>
            <Button
              disabled={selectedSourceCount === 0 || pendingAction === "prepare-story-context"}
              onClick={prepareStoryContext}
              size="sm"
              variant="primary"
            >
              <Layers3 className="size-4" aria-hidden="true" />
              Prepare story context
            </Button>
          </div>
          {sources.length === 0 ? (
            <div className="p-4 text-sm text-[color:var(--muted)]">
              Connect ChatGPT App, GitHub App, Codex MCP, or add a manual note to start.
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {sources.slice(0, 8).map((source) => (
                <li className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between" key={source.id}>
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      checked={selectedSourceIds.has(source.id)}
                      className="mt-1 size-4"
                      onChange={(event) => toggleSource(source.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{source.title}</span>
                      <span className="mt-1 block text-xs text-[color:var(--muted)]">
                        {source.sourceType} · {formatDate(source.sourceCreatedAt)}
                      </span>
                    </span>
                  </label>
                  <Badge variant={source.isPrivate ? "warning" : "accent"}>{source.isPrivate ? "Private" : "Public"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">3. Review evidence</h3>
              <Badge variant={factCounts.pending === 0 && factCounts.approved > 0 ? "success" : "neutral"}>
                {factCounts.approved} approved
              </Badge>
            </div>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">Pending</dt>
                <dd>{factCounts.pending}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">Private</dt>
                <dd>{factCounts.privateFacts}</dd>
              </div>
            </dl>
            <Button asChild className="mt-4 w-full" size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/extraction-review`}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Review facts
              </Link>
            </Button>
          </section>

          <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <h3 className="font-semibold">4. Generate draft</h3>
            <select
              className="mt-4 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              value={selectedTemplateId}
            >
              {templates.map((template) => (
                <option disabled={!template.available} key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button
              className="mt-3 w-full"
              disabled={!selectedTemplate || factCounts.approved === 0 || factCounts.pending > 0 || pendingAction === "generate-draft"}
              onClick={generateDraft}
              size="sm"
              variant="primary"
            >
              <Bot className="size-4" aria-hidden="true" />
              {factCounts.pending > 0 ? "Review evidence first" : "Generate draft"}
            </Button>
            <Button asChild className="mt-2 w-full" size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/templates`}>Open templates</Link>
            </Button>
          </section>
        </aside>
      </section>

      <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="flex flex-col gap-2 border-b border-[color:var(--border)] p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-semibold">2. Project timeline</h3>
            <p className="mt-1 text-sm text-[color:var(--muted)]">{timelineEventCount} ordered events from selected integrations and Storro activity</p>
          </div>
          <Badge variant={timelineEventCount > 0 ? "success" : "neutral"}>{timelineEventCount > 0 ? "Timeline ready" : "Empty"}</Badge>
        </div>
        {timeline.length === 0 ? (
          <p className="p-4 text-sm text-[color:var(--muted)]">Prepare story context after selecting sources to build the timeline.</p>
        ) : (
          <div className="grid gap-4 p-4">
            {timeline.slice(0, 5).map((day) => (
              <div className="grid gap-3" key={day.date}>
                <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">{day.date}</p>
                <ul className="grid gap-2">
                  {day.events.slice(0, 6).map((event) => {
                    const TimelineIcon = getTimelineIcon(event);

                    return (
                      <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] p-3" key={event.id}>
                        <TimelineIcon className="mt-0.5 size-4 text-[color:var(--muted)]" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{event.title}</p>
                            <Badge variant={event.isPrivate ? "warning" : "accent"}>{event.eventType}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-[color:var(--muted)]">{formatDate(event.occurredAt)}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-[color:var(--muted)]">{event.summary}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
        <summary className="cursor-pointer p-4 font-semibold">Advanced pipeline</summary>
        <div className="grid gap-6 border-t border-[color:var(--border)] p-4">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]">
              <div className="flex flex-col gap-3 border-b border-[color:var(--border)] p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-semibold">Sources and preparation</h3>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{selectedSourceCount} selected for extraction</p>
                </div>
                <div className="flex flex-wrap gap-2">
              <Button
                disabled={selectedSourceCount === 0 || pendingAction === "queue-extraction"}
                onClick={queueExtraction}
                size="sm"
                variant="primary"
              >
                <Layers3 className="size-4" aria-hidden="true" />
                Queue extraction
              </Button>
              <Button disabled={!runnableExtractionRunId || pendingAction?.startsWith("run-extraction")} onClick={runExtraction} size="sm" variant="secondary">
                <Play className="size-4" aria-hidden="true" />
                {normalizedChunkCount > 0 ? "Run queued extraction" : "Normalize first"}
              </Button>
            </div>
              </div>
          {sources.length === 0 ? (
            <div className="p-4 text-sm text-[color:var(--muted)]">
              Connect ChatGPT App, GitHub App, Codex MCP, or add a manual note to start the pipeline.
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {sources.map((source) => (
                <li className="grid gap-3 p-4" key={source.id}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <label className="flex min-w-0 items-start gap-3">
                      <input
                        checked={selectedSourceIds.has(source.id)}
                        className="mt-1 size-4"
                        onChange={(event) => toggleSource(source.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{source.title}</span>
                        <span className="mt-1 block text-xs text-[color:var(--muted)]">
                          {source.sourceType} · {source.status} · {source.chunkCount} chunks
                        </span>
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={source.parsedAt ? "success" : "neutral"}>{source.parsedAt ? "Parsed" : "Raw"}</Badge>
                      <Badge variant={source.normalizedCount > 0 ? "success" : "neutral"}>
                        {source.normalizedCount > 0 ? "Normalized" : "Not normalized"}
                      </Badge>
                      <Badge variant={source.isPrivate ? "warning" : "accent"}>{source.isPrivate ? "Private" : "Public"}</Badge>
                      {source.redactionBlocked === true ? <Badge variant="danger">Blocked</Badge> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={pendingAction === `parse:${source.id}`} onClick={() => prepareSource(source.id, "parse")} size="sm" variant="secondary">
                      <RefreshCw className="size-4" aria-hidden="true" />
                      Parse
                    </Button>
                    <Button disabled={pendingAction === `redact:${source.id}`} onClick={() => prepareSource(source.id, "redact")} size="sm" variant="secondary">
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      Redact
                    </Button>
                    <Button disabled={pendingAction === `normalize:${source.id}`} onClick={() => prepareSource(source.id, "normalize")} size="sm" variant="secondary">
                      <Layers3 className="size-4" aria-hidden="true" />
                      Normalize
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
            </div>

            <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Fact review</h3>
              <Badge variant={factCounts.approved > 0 ? "success" : "neutral"}>{factCounts.approved} approved</Badge>
            </div>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">Pending</dt>
                <dd>{factCounts.pending}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">Rejected</dt>
                <dd>{factCounts.rejected}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">Private</dt>
                <dd>{factCounts.privateFacts}</dd>
              </div>
            </dl>
            <Button asChild className="mt-4 w-full" size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/extraction-review`}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Review facts
              </Link>
            </Button>
          </section>

          <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Story planning</h3>
              <Bot className="size-4 text-[color:var(--muted)]" aria-hidden="true" />
            </div>
            <select
              className="mt-4 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              value={selectedTemplateId}
            >
              {templates.map((template) => (
                <option disabled={!template.available} key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button
              className="mt-3 w-full"
              disabled={!selectedTemplate || approvedFactCount === 0 || pendingAction === "generate-story-plan"}
              onClick={generateStoryPlan}
              size="sm"
              variant="primary"
            >
              <Bot className="size-4" aria-hidden="true" />
              Generate story plan
            </Button>
            <Button asChild className="mt-2 w-full" size="sm" variant="secondary">
              <Link href={`/dashboard/projects/${projectId}/templates`}>Open templates</Link>
            </Button>
          </section>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]">
          <div className="border-b border-[color:var(--border)] p-4">
            <h3 className="font-semibold">Story runs</h3>
          </div>
          {storyRuns.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--muted)]">No story plans yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {storyRuns.map((run) => (
                <li className="grid gap-3 p-4" key={run.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{run.templateId}</p>
                      <p className="mt-1 text-xs text-[color:var(--muted)]">{run.format} · {formatDate(run.createdAt)}</p>
                    </div>
                    <Badge variant={run.status === "FAILED" ? "danger" : run.status === "COMPLETED" ? "success" : "neutral"}>
                      {run.status}
                    </Badge>
                  </div>
                  {run.errorMessage ? <p className="text-xs text-red-700">{run.errorMessage}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {run.status === "NEEDS_REVIEW" && run.hasPlan ? (
                      <Button disabled={pendingAction === `approve-story:${run.id}`} onClick={() => approveStoryPlan(run.id)} size="sm" variant="secondary">
                        Approve plan
                      </Button>
                    ) : null}
                    {run.status === "COMPLETED" && run.hasPlan ? (
                      <Button disabled={pendingAction === `enqueue-artifact:${run.id}`} onClick={() => enqueueArtifact(run.id)} size="sm" variant="primary">
                        Queue artifact
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]">
          <div className="flex flex-col gap-3 border-b border-[color:var(--border)] p-4 md:flex-row md:items-center md:justify-between">
            <h3 className="font-semibold">Artifacts</h3>
            <Button disabled={!runnableGenerationJobId || pendingAction?.startsWith("run-artifact")} onClick={runArtifactJob} size="sm" variant="secondary">
              <Play className="size-4" aria-hidden="true" />
              Run queued job
            </Button>
          </div>
          {artifacts.length === 0 ? (
            <p className="p-4 text-sm text-[color:var(--muted)]">Generated artifacts will appear here for editing and export.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {artifacts.map((artifact) => (
                <li className="p-4" key={artifact.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={artifact.status === "EXPORT_READY" ? "success" : "neutral"}>{artifact.status}</Badge>
                    <Badge variant="accent">{artifact.format}</Badge>
                    <Badge variant={artifact.groundingState === "PASSED" ? "success" : "neutral"}>{artifact.groundingState}</Badge>
                  </div>
                  <Link
                    className="mt-3 block text-sm font-medium hover:text-[color:var(--accent)]"
                    href={`/dashboard/projects/${projectId}/artifacts/${artifact.id}/editor`}
                  >
                    {artifact.title}
                  </Link>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">{formatDate(artifact.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {extractionRuns.length > 0 ? (
        <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]">
          <div className="border-b border-[color:var(--border)] p-4">
            <h3 className="font-semibold">Extraction runs</h3>
          </div>
          <ul className="divide-y divide-[color:var(--border)]">
            {extractionRuns.map((run) => (
              <li className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between" key={run.id}>
                <div>
                  <p className="text-sm font-medium">{run.id}</p>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    {run.selectedSourceIds.length} selected sources · {formatDate(run.createdAt)}
                  </p>
                  {run.errorMessage ? <p className="mt-1 text-xs text-red-700">{run.errorMessage}</p> : null}
                </div>
                <Badge variant={run.status === "FAILED" ? "danger" : run.status === "COMPLETED" ? "success" : "neutral"}>
                  {run.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
        </div>
      </details>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getTimelineIcon(event: TimelineEventRow) {
  if (event.entityType === "chatgpt_message") {
    return MessageSquareText;
  }

  if (event.entityType === "github_commit" || event.entityType === "github_file_change") {
    return GitCommitHorizontal;
  }

  if (event.entityType === "codex_turn") {
    return Bot;
  }

  return Clock3;
}
