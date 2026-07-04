import { createHash } from "crypto";
import type { ArtifactFormat, Prisma, SourceType } from "@prisma/client";
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
  limit?: number;
};

type TimelineEvent = {
  id: string;
  entityType: "source_document" | "extraction_run" | "story_artifact" | "artifact_export" | "integration_event";
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

  const selectedSourceIds = selectedEvents
    .filter((event) => event.entityType === "source_document")
    .map((event) => event.entityId);
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
            content: "Write a grounded build journal using only the selected timeline events. Do not add claims that are absent from the events.",
          },
          {
            role: "user",
            content: JSON.stringify({
              title: input.title,
              mode: timeline.mode,
              view: timeline.view,
              selectedEvents,
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
          selectedTimelineEventIds: selectedEvents.map((event) => event.id),
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
    ...sources.map((source): TimelineEvent => ({
      id: `source_document:${source.id}`,
      entityType: "source_document",
      entityId: source.id,
      eventType: source.sourceType,
      title: source.title,
      summary: createSummary(source.rawText ?? source.title),
      sourceType: source.sourceType,
      isPrivate: source.isPrivate,
      occurredAt: (source.sourceCreatedAt ?? source.createdAt).toISOString(),
      metadata: source.metadata,
    })),
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

    return true;
  });
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

function isIntegrationAuditAction(action: string) {
  return action.startsWith("github.")
    || action.startsWith("chatgpt.")
    || action.startsWith("codex.")
    || action.startsWith("cli.")
    || action.startsWith("mcp.")
    || action.includes("integration");
}
