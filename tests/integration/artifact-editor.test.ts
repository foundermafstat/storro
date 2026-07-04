import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  diffArtifactRevisions,
  renderMarkdownPreviewHtml,
  restoreArtifactRevision,
  saveArtifactRevision,
} from "@/services/artifact-editor-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let artifactId = "";
let context: ScopedContext;

describe("artifact editor service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `editor-user-${suffix}`,
        email: `editor-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Editor Org ${suffix}`,
        slug: `editor-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });

    const project = await createProject(context, {
      name: `Editor Project ${suffix}`,
    });
    const extractionRun = await prisma.extractionRun.create({
      data: {
        orgId,
        projectId: project.id,
        createdById: userId,
        status: "COMPLETED",
        selectedSourceIds: [],
      },
    });
    const storyRun = await prisma.storyRun.create({
      data: {
        orgId,
        projectId: project.id,
        extractionRunId: extractionRun.id,
        createdById: userId,
        status: "COMPLETED",
        templateId: "github-release-notes",
        format: "GITHUB_RELEASE_NOTES",
      },
    });
    const artifact = await prisma.storyArtifact.create({
      data: {
        orgId,
        projectId: project.id,
        storyRunId: storyRun.id,
        format: "GITHUB_RELEASE_NOTES",
        status: "DRAFT",
        title: "Editor artifact",
        contentMarkdown: "## Added\n\nInitial content.",
      },
    });

    projectId = project.id;
    artifactId = artifact.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("creates revisions for autosave and manual save", async () => {
    const autosave = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nAutosaved content.",
      saveMode: "autosave",
    });
    const manual = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nManually saved content.",
      saveMode: "manual",
    });
    const revisions = await prisma.editorRevision.findMany({
      where: {
        artifactId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    expect(autosave.revision.contentHash).toHaveLength(64);
    expect(manual.revision.contentHash).toHaveLength(64);
    expect(revisions.length).toBeGreaterThanOrEqual(2);
  });

  it("restores an older revision and preserves provenance with a new revision", async () => {
    const first = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nVersion to restore.",
      saveMode: "manual",
    });
    await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nLater version.",
      saveMode: "manual",
    });
    const restored = await restoreArtifactRevision(context, {
      projectId,
      artifactId,
      revisionId: first.revision.id,
    });

    expect(restored.artifact.contentMarkdown).toBe("## Added\n\nVersion to restore.");
    expect(restored.revision.id).not.toBe(first.revision.id);
  });

  it("renders markdown preview with GFM tables", () => {
    const html = renderMarkdownPreviewHtml("| Area | Status |\n| --- | --- |\n| Preview | Done |");

    expect(html).toContain("<table>");
    expect(html).toContain("<th>Area</th>");
    expect(html).toContain("<td>Done</td>");
  });

  it("shows line-level revision diffs", async () => {
    const base = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nOld line",
      saveMode: "manual",
    });
    const compare = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: "## Added\n\nNew line",
      saveMode: "manual",
    });
    const diff = await diffArtifactRevisions(context, {
      projectId,
      artifactId,
      baseRevisionId: base.revision.id,
      compareRevisionId: compare.revision.id,
    });

    expect(diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "removed", text: "Old line" }),
        expect.objectContaining({ type: "added", text: "New line" }),
      ]),
    );
  });
});
