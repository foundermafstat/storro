import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  buildGitHubAppInstallUrl,
  createGitHubInstallationToken,
  type GitHubAppClient,
  handleGitHubInstallationCallback,
  selectGitHubRepositoriesForProject,
  disconnectGitHubInstallation,
} from "@/services/github-app-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

const fakeClient: GitHubAppClient = {
  async getInstallation(installationId) {
    return {
      installationId,
      accountLogin: "foundermafstat",
      accountType: "Organization",
      repositorySelection: "selected",
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
      repositories: [
        {
          id: 101,
          name: "storro",
          fullName: "foundermafstat/storro",
          private: false,
          htmlUrl: "https://github.com/foundermafstat/storro",
        },
      ],
    };
  },
  async createInstallationAccessToken(installationId, input) {
    return {
      token: `installation-token-${installationId}`,
      expiresAt: "2026-07-04T02:00:00Z",
      permissions: input?.permissions ?? { contents: "read" },
      repositories: [
        {
          id: 101,
          name: "storro",
          fullName: "foundermafstat/storro",
        },
      ],
    };
  },
};

describe("github app installation service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `github-user-${suffix}`,
        email: `github-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `GitHub Org ${suffix}`,
        slug: `github-org-${suffix}`,
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
      name: `GitHub Project ${suffix}`,
    });

    projectId = project.id;
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

  it("builds an install URL and stores callback installation metadata", async () => {
    const installUrl = buildGitHubAppInstallUrl({
      appSlug: "storro-production",
      state: "state-123",
    });
    const installation = await handleGitHubInstallationCallback(
      context,
      {
        installationId: "123456",
        setupAction: "install",
        state: "state-123",
      },
      fakeClient,
    );

    expect(installUrl).toBe("https://github.com/apps/storro-production/installations/new?state=state-123");
    expect(installation).toMatchObject({
      installationId: "123456",
      accountLogin: "foundermafstat",
      status: "CONNECTED",
    });
    expect(installation.permissions).toMatchObject({
      contents: "read",
    });
  });

  it("maps selected repositories to project source connections without storing PATs", async () => {
    const connections = await selectGitHubRepositoriesForProject(context, {
      projectId,
      installationId: "123456",
      repositories: [
        {
          id: 101,
          name: "storro",
          fullName: "foundermafstat/storro",
          htmlUrl: "https://github.com/foundermafstat/storro",
        },
      ],
    });

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      provider: "GITHUB",
      status: "CONNECTED",
      externalId: "123456:foundermafstat/storro",
      encryptedToken: null,
    });
  });

  it("generates installation tokens on demand without persisting them", async () => {
    const token = await createGitHubInstallationToken(
      context,
      {
        installationId: "123456",
        repositoryIds: [101],
        permissions: {
          contents: "read",
        },
      },
      fakeClient,
    );
    const connection = await prisma.sourceConnection.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        provider: "GITHUB",
      },
    });

    expect(token).toMatchObject({
      token: "installation-token-123456",
      expiresAt: "2026-07-04T02:00:00Z",
    });
    expect(connection.encryptedToken).toBeNull();
  });

  it("disconnects installations and marks repository connections historical", async () => {
    const disconnected = await disconnectGitHubInstallation(context, {
      installationId: "123456",
    });
    const connection = await prisma.sourceConnection.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        provider: "GITHUB",
      },
    });

    expect(disconnected.status).toBe("DISCONNECTED");
    expect(connection.status).toBe("DISCONNECTED");
    expect(connection.metadata).toMatchObject({
      historical: true,
    });
  });
});
