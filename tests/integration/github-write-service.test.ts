import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import type { GitHubAppClient } from "@/services/github-app-service";
import {
  executeGitHubWriteAction,
  type GitHubWriteClient,
  listGitHubWriteFeatures,
  prepareGitHubWriteAction,
} from "@/services/github-write-service";
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
      token: `write-token-${installationId}`,
      expiresAt: "2026-07-04T05:00:00Z",
    };
  },
};

class FakeWriteClient implements GitHubWriteClient {
  calls: Array<{ action: string; input: unknown }> = [];

  async createReleaseDraft(_: string, __: string, input: unknown) {
    this.calls.push({ action: "createReleaseDraft", input });
    return { id: 100, draft: true };
  }

  async createPullRequestComment(_: string, __: string, input: unknown) {
    this.calls.push({ action: "createPullRequestComment", input });
    return { id: 200 };
  }

  async createOrUpdateFile(_: string, __: string, input: unknown) {
    this.calls.push({ action: "createOrUpdateFile", input });
    return { content: { path: "CHANGELOG.md" } };
  }

  async publishReleaseDraft(_: string, __: string, input: unknown) {
    this.calls.push({ action: "publishReleaseDraft", input });
    return { id: 100, draft: false };
  }
}

describe("github write service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `github-write-user-${suffix}`,
        email: `github-write-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `GitHub Write Org ${suffix}`,
        slug: `github-write-org-${suffix}`,
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
      name: `GitHub Write Project ${suffix}`,
    });

    projectId = project.id;

    await prisma.githubInstallation.create({
      data: {
        orgId,
        installationId: "202020",
        accountLogin: "foundermafstat",
        accountType: "Organization",
        status: "CONNECTED",
        permissions: {
          contents: "read",
          pull_requests: "read",
        },
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

  it("hides write features without write permissions", async () => {
    const features = await listGitHubWriteFeatures(context, {
      projectId,
      installationId: "202020",
    });

    expect(features.every((feature) => !feature.available)).toBe(true);
  });

  it("returns exact dry-run preview when write permission is granted", async () => {
    await prisma.githubInstallation.update({
      where: {
        installationId: "202020",
      },
      data: {
        permissions: {
          contents: "write",
          pull_requests: "write",
        },
      },
    });
    const preview = await prepareGitHubWriteAction(context, {
      projectId,
      installationId: "202020",
      owner: "foundermafstat",
      repo: "storro",
      action: "UPSERT_CHANGELOG",
      filePath: "CHANGELOG.md",
      fileContent: "# Changes",
      commitMessage: "Update changelog",
      branch: "main",
    });

    expect(preview).toMatchObject({
      method: "PUT",
      path: "/repos/foundermafstat/storro/contents/CHANGELOG.md",
      requiredPermissions: { contents: "write" },
    });
    expect(preview.body).toMatchObject({
      message: "Update changelog",
      branch: "main",
    });
  });

  it("requires confirmation and records audit log for external writes", async () => {
    const client = new FakeWriteClient();

    await expect(
      executeGitHubWriteAction(
        context,
        {
          projectId,
          installationId: "202020",
          owner: "foundermafstat",
          repo: "storro",
          action: "CREATE_PR_COMMENT",
          pullRequestNumber: 7,
          commentBody: "Generated summary",
          confirmed: false,
        },
        appClient,
        () => client,
      ),
    ).rejects.toThrow("GitHub write action requires explicit confirmation.");

    const executed = await executeGitHubWriteAction(
      context,
      {
        projectId,
        installationId: "202020",
        owner: "foundermafstat",
        repo: "storro",
        action: "CREATE_PR_COMMENT",
        pullRequestNumber: 7,
        commentBody: "Generated summary",
        confirmed: true,
      },
      appClient,
      () => client,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        action: "github.write.executed",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(executed.result).toEqual({ id: 200 });
    expect(client.calls[0]).toMatchObject({ action: "createPullRequestComment" });
    expect(audit.entityId).toBe("foundermafstat/storro");
  });
});
