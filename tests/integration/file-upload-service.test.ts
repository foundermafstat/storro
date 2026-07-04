import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  calculateSha256,
  createSignedSourceFileDownloadUrl,
  deleteSourceFile,
  type ObjectStorageAdapter,
  prepareSourceFileUpload,
  uploadSourceFileBuffer,
  type VirusScanner,
} from "@/services/file-upload-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

class FakeStorage implements ObjectStorageAdapter {
  readonly provider = "fake-s3";
  readonly puts: string[] = [];
  readonly deletes: string[] = [];
  readonly signedUploads: string[] = [];
  readonly signedDownloads: string[] = [];

  async putObject(input: Parameters<ObjectStorageAdapter["putObject"]>[0]) {
    this.puts.push(input.objectKey);
  }

  async deleteObject(input: Parameters<ObjectStorageAdapter["deleteObject"]>[0]) {
    this.deletes.push(input.objectKey);
  }

  async createSignedUploadUrl(input: Parameters<ObjectStorageAdapter["createSignedUploadUrl"]>[0]) {
    this.signedUploads.push(input.objectKey);
    return `https://storage.test/upload/${encodeURIComponent(input.objectKey)}?expires=${input.expiresInSeconds}`;
  }

  async createSignedDownloadUrl(input: Parameters<ObjectStorageAdapter["createSignedDownloadUrl"]>[0]) {
    this.signedDownloads.push(input.objectKey);
    return `https://storage.test/download/${encodeURIComponent(input.objectKey)}?expires=${input.expiresInSeconds}`;
  }
}

const blockingScanner: VirusScanner = {
  async scanBuffer() {
    return { clean: false, reason: "blocked-test-signature" };
  },
};

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const encoder = new TextEncoder();

let orgId = "";
let userId = "";
let projectId = "";
let otherProjectId = "";
let context: ScopedContext;

describe("file upload service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `upload-user-${suffix}`,
        email: `upload-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Upload Org ${suffix}`,
        slug: `upload-org-${suffix}`,
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

    const [project, otherProject] = await Promise.all([
      createProject(context, {
        name: `Upload Project ${suffix}`,
      }),
      createProject(context, {
        name: `Other Upload Project ${suffix}`,
      }),
    ]);

    projectId = project.id;
    otherProjectId = otherProject.id;
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

  it("validates, stores metadata, signs URLs, and deletes scoped uploaded files", async () => {
    const storage = new FakeStorage();
    const bytes = encoder.encode("# Release notes\nSafe content.");

    const uploaded = await uploadSourceFileBuffer(
      context,
      {
        projectId,
        fileName: "release-notes.md",
        mimeType: "text/markdown",
        title: "Release notes upload",
        tags: ["release", "file"],
        isPrivate: true,
        bytes,
      },
      storage,
    );

    expect(uploaded.sourceFile.checksumSha256).toBe(calculateSha256(bytes));
    expect(uploaded.sourceFile.objectKey).toContain(`orgs/${orgId}/projects/${projectId}/sources/`);
    expect(storage.puts).toEqual([uploaded.sourceFile.objectKey]);

    const source = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: uploaded.sourceDocumentId,
      },
    });

    expect(source.status).toBe("UPLOADED");
    expect(source.rawObjectKey).toBe(uploaded.sourceFile.objectKey);
    expect(source.tags).toEqual(["release", "file"]);
    expect(source.metadata).toMatchObject({
      upload: {
        aiEligible: false,
        pipelineState: "uploaded_pending_parse",
      },
    });

    await expect(
      uploadSourceFileBuffer(
        context,
        {
          projectId,
          fileName: "malware.exe",
          mimeType: "application/octet-stream",
          bytes,
        },
        storage,
      ),
    ).rejects.toThrow("Unsupported file extension.");

    await expect(
      uploadSourceFileBuffer(
        context,
        {
          projectId,
          fileName: "blocked.txt",
          mimeType: "text/plain",
          bytes,
        },
        storage,
        blockingScanner,
      ),
    ).rejects.toThrow("File failed virus scan.");

    const jsonBytes = encoder.encode(JSON.stringify({ ok: true }));
    const prepared = await prepareSourceFileUpload(
      context,
      {
        projectId,
        fileName: "source.json",
        mimeType: "application/json",
        sizeBytes: jsonBytes.byteLength,
        checksumSha256: calculateSha256(jsonBytes),
        expiresInSeconds: 120,
      },
      storage,
    );

    expect(prepared.uploadUrl).toContain("expires=120");
    expect(storage.signedUploads).toContain(prepared.sourceFile.objectKey);

    const download = await createSignedSourceFileDownloadUrl(
      context,
      { sourceFileId: prepared.sourceFile.id, projectId },
      storage,
      300,
    );

    expect(download.downloadUrl).toContain("expires=300");
    expect(storage.signedDownloads).toEqual([prepared.sourceFile.objectKey]);

    await expect(
      createSignedSourceFileDownloadUrl(
        context,
        { sourceFileId: prepared.sourceFile.id, projectId: otherProjectId },
        storage,
      ),
    ).rejects.toThrow("Source file not found.");
    expect(storage.signedDownloads).toEqual([prepared.sourceFile.objectKey]);

    await expect(
      deleteSourceFile(
        context,
        { sourceFileId: prepared.sourceFile.id, projectId: otherProjectId },
        storage,
      ),
    ).rejects.toThrow("Source file not found.");
    expect(storage.deletes).toEqual([]);

    await deleteSourceFile(context, { sourceFileId: prepared.sourceFile.id, projectId }, storage);
    expect(storage.deletes).toEqual([prepared.sourceFile.objectKey]);

    const deletedFile = await prisma.sourceFile.findUnique({
      where: {
        id: prepared.sourceFile.id,
      },
    });

    expect(deletedFile).toBeNull();
  });
});
