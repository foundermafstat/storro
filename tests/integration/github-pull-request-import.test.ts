import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import type { GitHubAppClient } from "@/services/github-app-service";
import {
  type GitHubPullRequestClient,
  importGitHubPullRequests,
  listGitHubPullRequestsForSelection,
} from "@/services/github-pull-request-import-service";
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
      token: `pr-import-token-${installationId}`,
      expiresAt: "2026-07-04T04:00:00Z",
    };
  },
};

function pullRequestClient(): GitHubPullRequestClient {
  const pullRequests = [
    pr(1, "Add editor", "open", false),
    pr(2, "Add export", "closed", true),
    pr(3, "Document risk", "closed", false),
  ];

  return {
    async listPullRequests() {
      return pullRequests;
    },
    async getPullRequest(_, __, pullNumber) {
      const selected = pullRequests.find((item) => item.number === pullNumber);

      if (!selected) {
        throw new Error("missing pr");
      }

      return {
        ...selected,
        body: `Body for PR ${pullNumber}`,
        labels: ["backend"],
        reviewers: ["reviewer-a"],
        commentsSummary: `Comments summary for ${pullNumber}`,
        checksSummary: "CI passed",
        commits: [{ sha: `sha-${pullNumber}`, message: selected.title }],
        files: [
          {
            filename: `file-${pullNumber}.ts`,
            status: "modified",
            additions: 10,
            deletions: 1,
            changes: 11,
            patch: `@@ file ${pullNumber}`,
          },
        ],
      };
    },
  };
}

describe("github pull request import service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `pr-import-user-${suffix}`,
        email: `pr-import-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `PR Import Org ${suffix}`,
        slug: `pr-import-org-${suffix}`,
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
      name: `PR Import Project ${suffix}`,
    });

    projectId = project.id;

    await prisma.githubInstallation.create({
      data: {
        orgId,
        installationId: "777888",
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
        externalId: "777888:foundermafstat/storro",
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

  it("lists pull requests by repository filters", async () => {
    const pullRequests = await listGitHubPullRequestsForSelection(
      context,
      {
        projectId,
        installationId: "777888",
        owner: "foundermafstat",
        repo: "storro",
        branch: "main",
        state: "all",
      },
      appClient,
      () => pullRequestClient(),
    );

    expect(pullRequests.map((item) => item.number)).toEqual([1, 2, 3]);
  });

  it("imports only selected PR context into sources and normalized sources", async () => {
    const result = await importGitHubPullRequests(
      context,
      {
        projectId,
        installationId: "777888",
        owner: "foundermafstat",
        repo: "storro",
        pullRequestNumbers: [2],
      },
      appClient,
      () => pullRequestClient(),
    );
    const sources = await prisma.sourceDocument.findMany({
      where: {
        orgId,
        projectId,
        sourceType: "GITHUB_PULL_REQUEST",
      },
    });
    const normalized = await prisma.normalizedSource.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        sourceDocumentId: result.imported[0].source.id,
      },
    });

    expect(result.imported).toHaveLength(1);
    expect(sources.map((source) => source.title)).toEqual(["PR #2 Add export"]);
    expect(normalized.body).toContain("file-2.ts");
    expect(normalized.body).not.toContain("file-1.ts");
  });

  it("preserves open, closed, and merged PR statuses", async () => {
    const result = await importGitHubPullRequests(
      context,
      {
        projectId,
        installationId: "777888",
        owner: "foundermafstat",
        repo: "storro",
        pullRequestNumbers: [1, 3],
      },
      appClient,
      () => pullRequestClient(),
    );

    expect(result.imported.map((item) => ({
      number: item.pullRequest.number,
      state: item.pullRequest.state,
      merged: item.pullRequest.merged,
    }))).toEqual([
      { number: 1, state: "open", merged: false },
      { number: 3, state: "closed", merged: false },
    ]);
  });
});

function pr(number: number, title: string, state: "open" | "closed", merged: boolean) {
  return {
    number,
    title,
    state,
    merged,
    baseRef: "main",
    headRef: `feature-${number}`,
    htmlUrl: `https://github.com/foundermafstat/storro/pull/${number}`,
    updatedAt: "2026-07-04T01:00:00Z",
  };
}
