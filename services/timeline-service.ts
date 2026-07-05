import { createHash } from "crypto";
import type { ArtifactFormat, Prisma, SourceDocument, SourceType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import {
  callAiGateway,
  type AiGatewayProvider,
  type AiModelPolicy,
} from "@/services/ai-gateway";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type TimelineMode = "private_journal" | "public_update";
type TimelineView = "daily" | "weekly";

type TimelineInput = {
  projectId: string;
  view?: TimelineView;
  mode?: TimelineMode;
  sourceType?: SourceType;
  includePrivate?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  selectedEventIds?: string[];
  limit?: number;
};

export type TimelineEvent = {
  id: string;
  entityType:
    | "source_document"
    | "chatgpt_message"
    | "codex_turn"
    | "github_commit"
    | "github_file_change"
    | "extraction_run"
    | "story_artifact"
    | "artifact_export"
    | "integration_event";
  entityId: string;
  eventType: string;
  title: string;
  summary: string;
  sourceType: SourceType | null;
  isPrivate: boolean;
  occurredAt: string;
  metadata: Prisma.JsonValue;
};

const timelineArtifactSchema = z.object({
  title: z.string().min(1),
  contentMarkdown: z.string().min(1),
});

export async function getProjectTimeline(
  context: ScopedContext,
  input: TimelineInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "project.read", db);

  const view = input.view ?? "daily";
  const mode = input.mode ?? "private_journal";
  const includePrivate = mode === "public_update" ? false : input.includePrivate ?? true;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const events = applyTimelineFilters(
    await loadTimelineEvents(context, input, db),
    {
      ...input,
      includePrivate,
    },
  ).slice(0, limit);

  return {
    projectId: input.projectId,
    view,
    mode,
    includePrivate,
    days: groupTimelineEvents(events, view),
    events,
  };
}

export async function generateTimelineStoryArtifact(
  context: ScopedContext,
  input: TimelineInput & {
    title?: string;
    format?: ArtifactFormat;
    promptVersion?: string;
  },
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);

  const timeline = await getProjectTimeline(
    context,
    {
      ...input,
      mode: input.mode ?? "private_journal",
      view: input.view ?? "daily",
      includePrivate: input.mode === "public_update" ? false : input.includePrivate,
      limit: input.limit ?? 100,
    },
    db,
  );
  const selectedEvents = timeline.events;

  if (selectedEvents.length === 0) {
    throw new ValidationServiceError("Timeline generation requires at least one selected event.");
  }

  const orderedEvents = [...selectedEvents].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const selectedSourceIds = [
    ...new Set(
      selectedEvents
        .filter((event) => event.sourceType)
        .map((event) => event.entityId),
    ),
  ];
  const extractionRun = await db.extractionRun.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      createdById: context.userId,
      status: "COMPLETED",
      selectedSourceIds,
      projectSummary: `Timeline ${timeline.mode} generated from ${selectedEvents.length} selected events.`,
      completedAt: new Date(),
    },
  });
  const storyRun = await db.storyRun.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      extractionRunId: extractionRun.id,
      createdById: context.userId,
      status: "RUNNING",
      templateId: input.mode === "public_update" ? "timeline-public-update" : "daily-build-journal",
      format: input.format ?? "DAILY_BUILD_JOURNAL",
      audience: input.mode === "public_update" ? "public builders" : "project team",
      tone: input.mode === "public_update" ? "clear and publishable" : "specific and candid",
      promptVersion: input.promptVersion ?? "timeline-generation.v1",
      startedAt: new Date(),
      storyPlan: {
        mode: timeline.mode,
        view: timeline.view,
        selectedTimelineEventIds: selectedEvents.map((event) => event.id),
        dateRange: {
          createdFrom: input.createdFrom?.toISOString() ?? null,
          createdTo: input.createdTo?.toISOString() ?? null,
        },
      } as Prisma.InputJsonObject,
    },
  });

  try {
    const gatewayResult = await callAiGateway(
      context,
      {
        task: "generation",
        projectId: input.projectId,
        promptVersion: input.promptVersion ?? "timeline-generation.v1",
        messages: [
          {
            role: "system",
            content:
              "Write a grounded build journal using only the selected timeline events. Build the narrative around chronology, cause and effect, and how the project changed over time. Do not add claims that are absent from the events.",
          },
          {
            role: "user",
            content: JSON.stringify({
              title: input.title,
              mode: timeline.mode,
              view: timeline.view,
              orderedTimelineEvents: orderedEvents,
            }),
          },
        ],
        jsonSchema: {
          name: "storro_timeline_artifact",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              contentMarkdown: { type: "string" },
            },
            required: ["title", "contentMarkdown"],
          },
        },
        maxRetries: 1,
        backoffMs: 0,
      },
      provider,
      modelPolicy,
      db,
    );
    const parsed = timelineArtifactSchema.parse(gatewayResult.parsed);
    const contentHash = createHash("sha256").update(parsed.contentMarkdown).digest("hex");
    const artifact = await db.storyArtifact.create({
      data: {
        orgId: context.orgId,
        projectId: input.projectId,
        storyRunId: storyRun.id,
        format: input.format ?? "DAILY_BUILD_JOURNAL",
        status: "DRAFT",
        title: parsed.title,
        contentMarkdown: parsed.contentMarkdown,
        model: modelPolicy.generation,
        promptVersion: input.promptVersion ?? "timeline-generation.v1",
        metadata: {
          mode: timeline.mode,
          view: timeline.view,
          selectedTimelineEventIds: orderedEvents.map((event) => event.id),
          selectedSourceIds,
          dateRange: {
            createdFrom: input.createdFrom?.toISOString() ?? null,
            createdTo: input.createdTo?.toISOString() ?? null,
          },
        } as Prisma.InputJsonObject,
      },
    });
    await db.editorRevision.create({
      data: {
        orgId: context.orgId,
        projectId: input.projectId,
        artifactId: artifact.id,
        authorId: context.userId,
        contentMarkdown: artifact.contentMarkdown,
        contentHash,
      },
    });
    await db.storyRun.update({
      where: {
        id: storyRun.id,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return {
      timeline,
      storyRun,
      artifact,
    };
  } catch (error) {
    await db.storyRun.update({
      where: {
        id: storyRun.id,
      },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Timeline generation failed.",
      },
    });

    throw error;
  }
}

async function loadTimelineEvents(context: ScopedContext, input: TimelineInput, db: DatabaseClient): Promise<TimelineEvent[]> {
  const [sources, extractionRuns, artifacts, exports, auditLogs] = await Promise.all([
    db.sourceDocument.findMany({
      where: {
        orgId: context.orgId,
        projectId: input.projectId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.extractionRun.findMany({
      where: {
        orgId: context.orgId,
        projectId: input.projectId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.storyArtifact.findMany({
      where: {
        orgId: context.orgId,
        projectId: input.projectId,
        archivedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.artifactExport.findMany({
      where: {
        orgId: context.orgId,
        projectId: input.projectId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.auditLog.findMany({
      where: {
        orgId: context.orgId,
        OR: [
          { projectId: input.projectId },
          { projectId: null },
        ],
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    }),
  ]);

  return [
    ...sources.flatMap(sourceToTimelineEvents),
    ...extractionRuns.map((run): TimelineEvent => ({
      id: `extraction_run:${run.id}`,
      entityType: "extraction_run",
      entityId: run.id,
      eventType: "EXTRACTION",
      title: `Extraction ${run.status.toLowerCase()}`,
      summary: run.projectSummary ?? run.errorMessage ?? `${run.selectedSourceIds.length} selected sources`,
      sourceType: null,
      isPrivate: false,
      occurredAt: (run.completedAt ?? run.startedAt ?? run.createdAt).toISOString(),
      metadata: {
        status: run.status,
        selectedSourceIds: run.selectedSourceIds,
      },
    })),
    ...artifacts.map((artifact): TimelineEvent => ({
      id: `story_artifact:${artifact.id}`,
      entityType: "story_artifact",
      entityId: artifact.id,
      eventType: "ARTIFACT",
      title: artifact.title,
      summary: createSummary(artifact.contentMarkdown),
      sourceType: null,
      isPrivate: false,
      occurredAt: artifact.createdAt.toISOString(),
      metadata: {
        status: artifact.status,
        format: artifact.format,
        groundingState: artifact.groundingState,
      },
    })),
    ...exports.map((artifactExport): TimelineEvent => ({
      id: `artifact_export:${artifactExport.id}`,
      entityType: "artifact_export",
      entityId: artifactExport.id,
      eventType: "RELEASE",
      title: `${artifactExport.format} export`,
      summary: artifactExport.objectKey ?? "Artifact export created",
      sourceType: null,
      isPrivate: false,
      occurredAt: artifactExport.createdAt.toISOString(),
      metadata: artifactExport.metadata,
    })),
    ...auditLogs
      .filter((entry) => isIntegrationAuditAction(entry.action))
      .map((entry): TimelineEvent => ({
        id: `integration_event:${entry.id}`,
        entityType: "integration_event",
        entityId: entry.id,
        eventType: "INTEGRATION",
        title: entry.action,
        summary: entry.entityType,
        sourceType: null,
        isPrivate: false,
        occurredAt: entry.createdAt.toISOString(),
        metadata: entry.metadata,
      })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
}

function applyTimelineFilters(events: TimelineEvent[], input: TimelineInput & { includePrivate: boolean }) {
  return events.filter((event) => {
    if (!input.includePrivate && event.isPrivate) {
      return false;
    }
    if (input.sourceType && event.sourceType !== input.sourceType) {
      return false;
    }
    if (input.createdFrom && Date.parse(event.occurredAt) < input.createdFrom.getTime()) {
      return false;
    }
    if (input.createdTo && Date.parse(event.occurredAt) > input.createdTo.getTime()) {
      return false;
    }
    if (input.selectedEventIds?.length && !input.selectedEventIds.includes(event.id)) {
      return false;
    }

    return true;
  });
}

function sourceToTimelineEvents(source: SourceDocument): TimelineEvent[] {
  const metadata = toRecord(source.metadata);
  const sourceOccurredAt = readDate(
    readNested(metadata, ["chatGptConnector", "occurredAt"])
      ?? readNested(metadata, ["chatGptApp", "occurredAt"])
      ?? source.sourceCreatedAt
      ?? source.createdAt,
  ) ?? source.createdAt.toISOString();
  const base: TimelineEvent = {
    id: `source_document:${source.id}`,
    entityType: "source_document",
    entityId: source.id,
    eventType: source.sourceType,
    title: source.title,
    summary: createSummary(source.rawText ?? source.title),
    sourceType: source.sourceType,
    isPrivate: source.isPrivate,
    occurredAt: sourceOccurredAt,
    metadata: source.metadata,
  };

  return [
    base,
    ...chatGptMessageEvents(source, metadata, sourceOccurredAt),
    ...codexTurnEvents(source, metadata, sourceOccurredAt),
    ...githubCommitEvents(source, metadata, sourceOccurredAt),
  ];
}

function chatGptMessageEvents(source: SourceDocument, metadata: JsonRecord | null, fallbackDate: string): TimelineEvent[] {
  if (source.sourceType !== "CHATGPT_EXPORT" && source.sourceType !== "CHATGPT_NOTE") {
    return [];
  }

  const chatgpt = toRecord(metadata?.chatgpt);
  const connector = toRecord(metadata?.chatGptConnector) ?? toRecord(metadata?.chatGptApp);
  const messages = readArray(connector?.messageTimeline).length > 0
    ? readArray(connector?.messageTimeline)
    : readArray(chatgpt?.messages);
  const conversationId = readString(connector?.conversationId) ?? readString(chatgpt?.conversationId);
  const conversationTitle = readString(chatgpt?.title) ?? source.title;

  return messages.flatMap((message, index) => {
    const item = toRecord(message);

    if (!item) {
      return [];
    }

    const role = readString(item.role) ?? "message";
    const occurredAt = readDate(item.occurredAt ?? item.createdAt) ?? fallbackDate;
    const messageId = readString(item.messageId) ?? readString(item.id) ?? String(index + 1);
    const summary = readString(item.summary) ?? readString(item.text) ?? `Selected ${role} message from ${conversationTitle}.`;

    return [{
      id: `chatgpt_message:${source.id}:${messageId}`,
      entityType: "chatgpt_message",
      entityId: source.id,
      eventType: `CHATGPT_${role.toUpperCase()}_MESSAGE`,
      title: `${conversationTitle} · ${role}`,
      summary: createSummary(summary),
      sourceType: source.sourceType,
      isPrivate: source.isPrivate,
      occurredAt,
      metadata: {
        conversationId,
        messageId,
        role,
        order: readNumber(item.order) ?? index,
      },
    } satisfies TimelineEvent];
  });
}

function codexTurnEvents(source: SourceDocument, metadata: JsonRecord | null, fallbackDate: string): TimelineEvent[] {
  if (source.sourceType !== "CODEX_NOTE") {
    return [];
  }

  const turn = toRecord(metadata?.codexTurn);
  const evidence = toRecord(metadata?.codexEvidence);
  const events: TimelineEvent[] = [];

  if (turn) {
    const occurredAt = readDate(turn.occurredAt) ?? fallbackDate;
    const prompt = readString(turn.prompt) ?? source.title;
    const responseSummary = readString(turn.responseSummary) ?? createSummary(source.rawText ?? source.title);
    const decisions = readStringArray(turn.decisions);
    const fixes = readStringArray(turn.fixes);

    events.push({
      id: `codex_turn:${source.id}`,
      entityType: "codex_turn",
      entityId: source.id,
      eventType: "CODEX_TURN",
      title: `Codex prompt · ${createSummary(prompt).slice(0, 80)}`,
      summary: createSummary([responseSummary, ...decisions, ...fixes].join(" ")),
      sourceType: source.sourceType,
      isPrivate: source.isPrivate,
      occurredAt,
      metadata: turn as Prisma.JsonObject,
    });
  }

  const prompts = readArray(evidence?.prompts);

  for (const [index, promptValue] of prompts.entries()) {
    const promptRecord = toRecord(promptValue);
    const prompt = readString(promptRecord?.prompt) ?? readString(promptValue);

    if (!prompt) {
      continue;
    }

    const occurredAt = readDate(promptRecord?.occurredAt ?? evidence?.markedAt) ?? fallbackDate;
    const decisions = readStringArray(evidence?.decisions);
    const fixes = readStringArray(evidence?.fixes);
    const branchNames = readStringArray(evidence?.branchNames);
    const commitRange = readString(evidence?.commitRange);

    events.push({
      id: `codex_turn:${source.id}:prompt:${index + 1}`,
      entityType: "codex_turn",
      entityId: source.id,
      eventType: "CODEX_PROMPT",
      title: `Codex prompt · ${createSummary(prompt).slice(0, 80)}`,
      summary: createSummary([...decisions, ...fixes, prompt].join(" ")),
      sourceType: source.sourceType,
      isPrivate: source.isPrivate,
      occurredAt,
      metadata: {
        prompt,
        decisions,
        fixes,
        branchNames,
        commitRange,
      },
    });
  }

  return events;
}

function githubCommitEvents(source: SourceDocument, metadata: JsonRecord | null, fallbackDate: string): TimelineEvent[] {
  if (source.sourceType !== "GITHUB_COMMIT") {
    return [];
  }

  const github = toRecord(metadata?.github);
  const commit = toRecord(github?.commit);

  if (!commit) {
    return [];
  }

  const sha = readString(commit.sha) ?? source.id;
  const message = readString(commit.message) ?? source.title;
  const files = readArray(commit.files);
  const stats = toRecord(commit.stats);
  const occurredAt = readDate(commit.committedAt ?? commit.authoredAt) ?? fallbackDate;
  const branch = readString(github?.selectedBranch) ?? readArray(github?.branches).map((item) => readString(item)).find(Boolean);
  const commitStats = {
    additions: readNumber(stats?.additions) ?? 0,
    deletions: readNumber(stats?.deletions) ?? 0,
    total: readNumber(stats?.total) ?? 0,
  };
  const commitEvent: TimelineEvent = {
    id: `github_commit:${source.id}:${sha}`,
    entityType: "github_commit",
    entityId: source.id,
    eventType: "GITHUB_COMMIT",
    title: message.split("\n")[0] || source.title,
    summary: createSummary(`${sha.slice(0, 7)} · ${files.length} files · +${commitStats.additions} -${commitStats.deletions}`),
    sourceType: source.sourceType,
    isPrivate: source.isPrivate,
    occurredAt,
    metadata: {
      sha,
      branch,
      stats: commitStats,
    },
  };

  return [
    commitEvent,
    ...files.flatMap((file, index) => {
      const item = toRecord(file);
      const filename = readString(item?.filename);

      if (!item || !filename) {
        return [];
      }
      const status = readString(item.status) ?? "changed";
      const additions = readNumber(item.additions) ?? 0;
      const deletions = readNumber(item.deletions) ?? 0;
      const changes = readNumber(item.changes) ?? additions + deletions;

      return [{
        id: `github_file_change:${source.id}:${sha}:${index + 1}`,
        entityType: "github_file_change",
        entityId: source.id,
        eventType: "GITHUB_FILE_CHANGE",
        title: filename,
        summary: `${status} · +${additions} -${deletions}`,
        sourceType: source.sourceType,
        isPrivate: source.isPrivate,
        occurredAt,
        metadata: {
          sha,
          branch,
          filename,
          status,
          additions,
          deletions,
          changes,
        },
      } satisfies TimelineEvent];
    }),
  ];
}

function groupTimelineEvents(events: TimelineEvent[], view: TimelineView) {
  const groups = new Map<string, TimelineEvent[]>();

  for (const event of events) {
    const key = view === "weekly" ? weekKey(event.occurredAt) : dayKey(event.occurredAt);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()].map(([date, groupedEvents]) => ({
    date,
    events: groupedEvents,
  }));
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

function weekKey(value: string) {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function createSummary(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function readNested(record: JsonRecord | null, path: string[]) {
  let current: unknown = record;

  for (const key of path) {
    const currentRecord = toRecord(current);

    if (!currentRecord) {
      return undefined;
    }

    current = currentRecord[key];
  }

  return current;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  return readArray(value).flatMap((item) => {
    const text = readString(item);

    return text ? [text] : [];
  });
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isIntegrationAuditAction(action: string) {
  return action.startsWith("github.")
    || action.startsWith("chatgpt.")
    || action.startsWith("codex.")
    || action.startsWith("cli.")
    || action.startsWith("mcp.")
    || action.includes("integration");
}
