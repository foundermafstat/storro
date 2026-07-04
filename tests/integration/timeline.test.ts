import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  type AiGatewayProvider,
  createAiModelPolicy,
  type AiGatewayProviderRequest,
} from "@/services/ai-gateway";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createStructuredManualNote } from "@/services/manual-note-service";
import { generateTimelineStoryArtifact, getProjectTimeline } from "@/services/timeline-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const selectedDate = new Date("2026-07-04T12:00:00.000Z");
const oldDate = new Date("2026-07-01T12:00:00.000Z");
const modelPolicy = createAiModelPolicy({
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
});

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

function providerWithArtifact(requests: AiGatewayProviderRequest[]): AiGatewayProvider {
  return {
    async createResponse(request) {
      requests.push(request);

      return {
        id: `timeline-${Date.now()}`,
        status: "completed",
        outputParsed: {
          title: "Daily build journal",
          contentMarkdown: "## Daily build journal\n\nOnly the selected in-range daily build events were used.",
        },
        usage: {
          totalTokens: 23,
        },
      };
    },
  };
}

describe("timeline service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({ data: { authUserId: `timeline-user-${suffix}`, email: `timeline-${suffix}@storro.local` } });
    const org = await prisma.organization.create({ data: { name: `Timeline Org ${suffix}`, slug: `timeline-org-${suffix}` } });
    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };
    await prisma.membership.create({ data: { orgId, userId, role: "OWNER" } });
    const project = await createProject(context, { name: `Timeline Project ${suffix}` });
    projectId = project.id;

    const selectedNote = await createStructuredManualNote(context, {
      projectId,
      title: "In-range daily build",
      kind: "daily_journal",
      whatWorked: "Implemented the selected timeline journal flow.",
      privateNotes: "Private journal note for the team.",
      isPrivate: true,
      tags: ["timeline"],
      sourceCreatedAt: selectedDate,
    });
    await createStructuredManualNote(context, {
      projectId,
      title: "Outside old journal",
      kind: "daily_journal",
      whatWorked: "This old event must not be selected by the date range.",
      isPrivate: true,
      tags: ["timeline"],
      sourceCreatedAt: oldDate,
    });
    await prisma.sourceDocument.create({
      data: {
        orgId,
        projectId,
        createdById: userId,
        sourceType: "GITHUB_COMMIT",
        title: "Public commit event",
        rawText: "A public GitHub commit is visible in public update mode.",
        tags: ["github"],
        isPrivate: false,
        sourceCreatedAt: selectedDate,
      },
    });
    const extractionRun = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [selectedNote.id],
        projectSummary: "Timeline extraction completed.",
        completedAt: selectedDate,
      },
    });
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId,
        extractionRunId: extractionRun.id,
        createdById: userId,
        status: "COMPLETED",
        templateId: "daily-build-journal",
        format: "DAILY_BUILD_JOURNAL",
        storyPlan: { selectedSourceIds: [selectedNote.id] },
        completedAt: selectedDate,
      },
    });
    const artifact = await prisma.storyArtifact.create({
      data: {
        orgId,
        projectId,
        storyRunId: storyRun.id,
        format: "DAILY_BUILD_JOURNAL",
        status: "DRAFT",
        title: "Existing daily artifact",
        contentMarkdown: "Existing daily artifact is part of the timeline.",
        createdAt: selectedDate,
      },
    });
    await prisma.artifactExport.create({
      data: {
        orgId,
        projectId,
        artifactId: artifact.id,
        format: "DAILY_BUILD_JOURNAL",
        status: "EXPORTED",
        objectKey: `timeline/${suffix}/daily.md`,
        createdAt: selectedDate,
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId,
        projectId,
        userId,
        action: "github.connection.resync_requested",
        entityType: "SourceConnection",
        createdAt: selectedDate,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("groups timeline events by day and filters by source type and privacy", async () => {
    const daily = await getProjectTimeline(context, {
      projectId,
      view: "daily",
      mode: "private_journal",
      createdFrom: new Date("2026-07-04T00:00:00.000Z"),
      createdTo: new Date("2026-07-04T23:59:59.999Z"),
    });
    expect(daily.days).toHaveLength(1);
    expect(daily.days[0].date).toBe("2026-07-04");
    expect(daily.events.map((event) => event.entityType)).toEqual(expect.arrayContaining(["source_document", "extraction_run", "story_artifact", "artifact_export", "integration_event"]));

    const manualOnly = await getProjectTimeline(context, {
      projectId,
      sourceType: "MANUAL_NOTE",
      includePrivate: true,
    });
    expect(manualOnly.events.every((event) => event.sourceType === "MANUAL_NOTE")).toBe(true);

    const publicUpdate = await getProjectTimeline(context, {
      projectId,
      mode: "public_update",
    });
    expect(publicUpdate.events.some((event) => event.title === "In-range daily build")).toBe(false);
    expect(publicUpdate.events.some((event) => event.title === "Public commit event")).toBe(true);
  });

  it("generates a daily journal artifact from only selected date-range events", async () => {
    const requests: AiGatewayProviderRequest[] = [];
    const result = await generateTimelineStoryArtifact(
      context,
      {
        projectId,
        title: "Daily build journal",
        view: "daily",
        mode: "private_journal",
        createdFrom: new Date("2026-07-04T00:00:00.000Z"),
        createdTo: new Date("2026-07-04T23:59:59.999Z"),
      },
      providerWithArtifact(requests),
      modelPolicy,
    );
    const promptPayload = requests[0].messages.find((message) => message.role === "user")?.content ?? "";
    const revision = await prisma.editorRevision.findFirstOrThrow({
      where: {
        artifactId: result.artifact.id,
      },
    });

    expect(promptPayload).toContain("In-range daily build");
    expect(promptPayload).not.toContain("Outside old journal");
    expect(result.artifact).toMatchObject({
      title: "Daily build journal",
      format: "DAILY_BUILD_JOURNAL",
      status: "DRAFT",
      model: "gpt-test-generation",
    });
    expect(revision.contentHash).toHaveLength(64);
    expect(result.timeline.events.every((event) => Date.parse(event.occurredAt) >= Date.parse("2026-07-04T00:00:00.000Z"))).toBe(true);
  });
});
