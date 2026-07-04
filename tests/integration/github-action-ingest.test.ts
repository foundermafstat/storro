import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import type { ObjectStorageAdapter } from "@/services/file-upload-service";
import {
  createGitHubActionIngestToken,
  ingestGitHubActionArtifact,
  maxInlineGithubActionDiffBytes,
} from "@/services/github-action-ingest-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let ingestToken = "";
let context: ScopedContext;

class MemoryStorageAdapter implements ObjectStorageAdapter {
  provider = "memory";
  objects = new Map<string, string>();

  async putObject(input: { objectKey: string; body: Uint8Array }) {
    this.objects.set(input.objectKey, new TextDecoder().decode(input.body));
  }

  async deleteObject(input: { objectKey: string }) {
    this.objects.delete(input.objectKey);
  }

  async createSignedUploadUrl() {
    return "memory://upload";
  }

  async createSignedDownloadUrl() {
    return "memory://download";
  }
}

describe("github action ingest service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `action-ingest-user-${suffix}`,
        email: `action-ingest-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Action Ingest Org ${suffix}`,
        slug: `action-ingest-org-${suffix}`,
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
      name: `Action Ingest Project ${suffix}`,
    });
    const token = await createGitHubActionIngestToken(context, {
      projectId: project.id,
      label: "ci",
    });

    projectId = project.id;
    ingestToken = token.token;
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

  it("rejects invalid ingest tokens", async () => {
    await expect(
      ingestGitHubActionArtifact(payload(), "invalid-token", new MemoryStorageAdapter()),
    ).rejects.toThrow("Invalid GitHub Action ingest token.");
  });

  it("creates source documents for valid action payloads", async () => {
    const result = await ingestGitHubActionArtifact(payload(), ingestToken, new MemoryStorageAdapter());

    expect(result.source.sourceType).toBe("CLI_SNAPSHOT");
    expect(result.source.rawText).toContain("GitHub Actions collected context.");
  });

  it("stores large full diff artifacts in object storage", async () => {
    const storage = new MemoryStorageAdapter();
    const result = await ingestGitHubActionArtifact(
      {
        ...payload(),
        sha: "bbbbbbb",
        fullDiff: "x".repeat(maxInlineGithubActionDiffBytes + 1),
      },
      ingestToken,
      storage,
    );

    expect(result.diffObjectKey).toBeTruthy();
    expect(storage.objects.get(result.diffObjectKey ?? "")).toHaveLength(maxInlineGithubActionDiffBytes + 1);
    expect(result.source.rawObjectKey).toBe(result.diffObjectKey);
  });

  it("documents a testable GitHub Action workflow", () => {
    const workflow = readFileSync("docs/examples/storro-github-action-ingest.yml", "utf8");

    expect(workflow).toContain("STORRO_INGEST_TOKEN");
    expect(workflow).toContain("/api/ingest/github-action");
  });
});

function payload() {
  return {
    projectId,
    repository: "foundermafstat/storro",
    runId: `run-${suffix}`,
    runAttempt: "1",
    sha: "aaaaaaa",
    ref: "feature/stage-36",
    pullRequestNumber: 36,
    diffStat: "1 file changed",
    fullDiff: "@@ diff",
    testResults: "tests passed",
    changedFiles: ["services/github-action-ingest-service.ts"],
    dependencyChanges: "none",
    migrationSummary: "none",
    ciContext: "GitHub Actions collected context.",
  };
}
