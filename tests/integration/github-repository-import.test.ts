import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { RateLimitError } from "@/services/errors";
import type { GitHubAppClient } from "@/services/github-app-service";
import {
  type GitHubRepositoryClient,
  importGitHubRepository,
} from "@/services/github-repository-import-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

const appClient: GitHubAppClient = {
  async getInstallation(installationId) {
    return {
      installationId,
      accountLogin: "foundermafstat",
      accountType: "Organization",
    };
  },
  async createInstallationAccessToken(installationId) {
    return {
      token: `repo-import-token-${installationId}`,
      expiresAt: "2026-07-04T03:00:00Z",
    };
  },
};

function repositoryClient(): GitHubRepositoryClient {
  return {
    async getRepository() {
      return {
        id: 101,
        name: "storro",
        fullName: "foundermafstat/storro",
        defaultBranch: "main",
        private: false,
        htmlUrl: "https://github.com/foundermafstat/storro",
        description: "Storro repo",
      };
    },
    async listBranches() {
      return [
        {
          name: "main",
          sha: "abc123",
        },
      ];
    },
    async listCommits() {
      return [
        {
          sha: "abc123456789",
        },
      ];
    },
    async getCommit() {
      return {
        sha: "abc123456789",
        htmlUrl: "https://github.com/foundermafstat/storro/commit/abc123456789",
        message: "Add repository import\n\nDetailed commit body.",
        authorName: "I.",
        authorEmail: "irine@example.com",
        authorLogin: "irine",
        authoredAt: "2026-07-04T01:00:00Z",
        committedAt: "2026-07-04T01:05:00Z",
        stats: {
          additions: 12,
          deletions: 2,
          total: 14,
        },
        files: [
          {
            filename: "services/github-repository-import-service.ts",
            status: "added",
            additions: 12,
            deletions: 0,
            changes: 12,
            patch: "@@ import service",
          },
        ],
      };
    },
  };
}

describe("github repository import service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `repo-import-user-${suffix}`,
        email: `repo-import-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Repo Import Org ${suffix}`,
        slug: `repo-import-org-${suffix}`,
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
      name: `Repo Import Project ${suffix}`,
    });

    projectId = project.id;

    await prisma.githubInstallation.create({
      data: {
        orgId,
        installationId: "654321",
        accountLogin: "foundermafstat",
        accountType: "Organization",
        status: "CONNECTED",
      },
    });
    await prisma.sourceConnection.create({
      data: {
        orgId,
        projectId,
        provider: "GITHUB",
        status: "CONNECTED",
        externalId: "654321:foundermafstat/storro",
        displayName: "foundermafstat/storro",
      },
    });
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

  it("imports repository metadata, commits, source documents, and normalized sources", async () => {
    const result = await importGitHubRepository(
      context,
      {
        projectId,
        installationId: "654321",
        owner: "foundermafstat",
        repo: "storro",
        maxCommits: 1,
      },
      appClient,
      () => repositoryClient(),
    );

    const importedSource = await prisma.sourceDocument.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        sourceType: "GITHUB_COMMIT",
      },
    });
    const normalized = await prisma.normalizedSource.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        sourceDocumentId: importedSource.id,
      },
    });

    expect(result.status).toBe("IMPORTED");
    expect(result.imported).toHaveLength(1);
    expect(importedSource.title).toContain("Add repository import");
    expect(importedSource.rawText).toContain("services/github-repository-import-service.ts");
    expect(normalized.body).toContain("Commit abc123456789");
  });

  it("records recoverable integration errors on GitHub rate limits", async () => {
    const result = await importGitHubRepository(
      context,
      {
        projectId,
        installationId: "654321",
        owner: "foundermafstat",
        repo: "storro",
        maxCommits: 1,
      },
      appClient,
      () => ({
        ...repositoryClient(),
        async getRepository() {
          throw new RateLimitError("GitHub rate limit exceeded.", {
            resetAt: "2026-07-04T04:00:00Z",
          });
        },
      }),
    );
    const connection = await prisma.sourceConnection.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        provider: "GITHUB",
      },
    });

    expect(result.status).toBe("RECOVERABLE_ERROR");
    expect(connection.status).toBe("ERROR");
    expect(connection.metadata).toMatchObject({
      lastError: {
        recoverable: true,
      },
    });
  });
});
