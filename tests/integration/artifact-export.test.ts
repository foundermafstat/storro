import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  createArtifactExport,
  createArtifactExportDownloadUrl,
} from "@/services/artifact-export-service";
import type { ObjectStorageAdapter } from "@/services/file-upload-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let artifactId = "";
let revisionId = "";
let failedArtifactId = "";
let context: ScopedContext;

class MemoryStorageAdapter implements ObjectStorageAdapter {
  provider = "memory";
  objects = new Map<string, { body: string; mimeType: string }>();

  async putObject(input: { objectKey: string; body: Uint8Array; mimeType: string }) {
    this.objects.set(input.objectKey, {
      body: new TextDecoder().decode(input.body),
      mimeType: input.mimeType,
    });
  }

  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
  }

  async createSignedUploadUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return `https://signed.local/upload/${input.objectKey}?expires=${input.expiresInSeconds}`;
  }

  async createSignedDownloadUrl(input: { objectKey: string; expiresInSeconds: number }) {
    return `https://signed.local/download/${input.objectKey}?expires=${input.expiresInSeconds}`;
  }
}

describe("artifact export service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `export-user-${suffix}`,
        email: `export-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Export Org ${suffix}`,
        slug: `export-org-${suffix}`,
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
      name: `Export Project ${suffix}`,
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
        status: "EXPORT_READY",
        groundingState: "PASSED",
        title: "Export artifact",
        contentMarkdown: "## Added\n\nExport system stores markdown.",
      },
    });
    const revision = await prisma.editorRevision.create({
      data: {
        orgId,
        projectId: project.id,
        artifactId: artifact.id,
        authorId: userId,
        contentMarkdown: artifact.contentMarkdown,
        contentHash: "a".repeat(64),
        groundingState: "PASSED",
      },
    });
    const failedArtifact = await prisma.storyArtifact.create({
      data: {
        orgId,
        projectId: project.id,
        storyRunId: storyRun.id,
        format: "GITHUB_RELEASE_NOTES",
        status: "REVIEW_REQUIRED",
        groundingState: "FAILED",
        title: "Failed artifact",
        contentMarkdown: "## Added\n\nUnsupported claim.",
      },
    });

    projectId = project.id;
    artifactId = artifact.id;
    revisionId = revision.id;
    failedArtifactId = failedArtifact.id;
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

  it("exports markdown and plain text files with scoped expiring download URLs", async () => {
    const storage = new MemoryStorageAdapter();
    const markdown = await createArtifactExport(
      context,
      {
        projectId,
        artifactId,
        revisionId,
        exportFormat: "MARKDOWN",
        expiresInSeconds: 600,
      },
      storage,
    );
    const plain = await createArtifactExport(
      context,
      {
        projectId,
        artifactId,
        revisionId,
        exportFormat: "PLAIN_TEXT",
        expiresInSeconds: 600,
      },
      storage,
    );

    expect(markdown.export.revisionId).toBe(revisionId);
    expect(markdown.downloadUrl).toContain("expires=600");
    expect(storage.objects.get(markdown.export.objectKey ?? "")?.body).toBe("## Added\n\nExport system stores markdown.");
    expect(storage.objects.get(plain.export.objectKey ?? "")?.body).toBe("Added\n\nExport system stores markdown.");

    const signed = await createArtifactExportDownloadUrl(
      context,
      {
        projectId,
        exportId: markdown.export.id,
        expiresInSeconds: 120,
      },
      storage,
    );

    expect(signed.downloadUrl).toContain("expires=120");
  });

  it("supports PDF-ready HTML, release notes, and clipboard copy exports", async () => {
    const storage = new MemoryStorageAdapter();
    const html = await createArtifactExport(context, { projectId, artifactId, revisionId, exportFormat: "PDF_HTML" }, storage);
    const releaseNotes = await createArtifactExport(context, { projectId, artifactId, revisionId, exportFormat: "RELEASE_NOTES" }, storage);
    const clipboard = await createArtifactExport(context, { projectId, artifactId, revisionId, exportFormat: "CLIPBOARD" }, storage);

    expect(storage.objects.get(html.export.objectKey ?? "")?.body).toContain("<!doctype html>");
    expect(storage.objects.get(releaseNotes.export.objectKey ?? "")?.body).toContain("# Export artifact");
    expect(clipboard.content).toBe("## Added\n\nExport system stores markdown.");
    expect(clipboard.export.objectKey).toBeNull();
  });

  it("blocks failed grounding unless override is audited", async () => {
    const storage = new MemoryStorageAdapter();

    await expect(
      createArtifactExport(
        context,
        {
          projectId,
          artifactId: failedArtifactId,
          exportFormat: "MARKDOWN",
        },
        storage,
      ),
    ).rejects.toThrow("Artifact is not export-ready because grounding review failed or is incomplete.");

    const overridden = await createArtifactExport(
      context,
      {
        projectId,
        artifactId: failedArtifactId,
        exportFormat: "MARKDOWN",
        overrideGrounding: true,
        overrideReason: "Founder-approved emergency export for internal review.",
      },
      storage,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        action: "artifact.export.override",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(overridden.export.id).toBeTruthy();
    expect(audit.entityId).toBe(failedArtifactId);
  });
});
