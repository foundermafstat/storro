import { createSign } from "crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ServerEnv } from "@/server/env";
import { assertIntegrationManagement, assertProjectPermission } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type GitHubRepositorySelection = {
  id: number;
  name: string;
  fullName: string;
  private?: boolean;
  htmlUrl?: string;
};

export type GitHubInstallationInfo = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection?: string;
  permissions?: Record<string, string>;
  repositories?: GitHubRepositorySelection[];
};

export type GitHubInstallationToken = {
  token: string;
  expiresAt: string;
  permissions?: Record<string, string>;
  repositories?: GitHubRepositorySelection[];
};

export type GitHubAppClient = {
  getInstallation(installationId: string): Promise<GitHubInstallationInfo>;
  createInstallationAccessToken(
    installationId: string,
    input?: {
      repositoryIds?: number[];
      permissions?: Record<string, string>;
    },
  ): Promise<GitHubInstallationToken>;
};

const repositorySelectionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  fullName: z.string().min(1),
  private: z.boolean().optional(),
  htmlUrl: z.string().url().optional(),
});

export class GitHubRestAppClient implements GitHubAppClient {
  constructor(
    private readonly env: Pick<ServerEnv, "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getInstallation(installationId: string): Promise<GitHubInstallationInfo> {
    const payload = await this.githubJson(`/app/installations/${installationId}`, {
      method: "GET",
    });
    const record = assertRecord(payload);
    const account = assertRecord(record.account);

    return {
      installationId: String(record.id ?? installationId),
      accountLogin: String(account.login ?? ""),
      accountType: String(account.type ?? ""),
      repositorySelection: typeof record.repository_selection === "string" ? record.repository_selection : undefined,
      permissions: readStringRecord(record.permissions),
    };
  }

  async createInstallationAccessToken(
    installationId: string,
    input: {
      repositoryIds?: number[];
      permissions?: Record<string, string>;
    } = {},
  ): Promise<GitHubInstallationToken> {
    const payload = await this.githubJson(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      body: JSON.stringify({
        repository_ids: input.repositoryIds,
        permissions: input.permissions,
      }),
    });
    const record = assertRecord(payload);

    return {
      token: String(record.token ?? ""),
      expiresAt: String(record.expires_at ?? ""),
      permissions: readStringRecord(record.permissions),
      repositories: Array.isArray(record.repositories)
        ? record.repositories.map((repository) => mapGitHubRepository(assertRecord(repository)))
        : undefined,
    };
  }

  private async githubJson(path: string, init: RequestInit) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${createGitHubAppJwt(this.env.GITHUB_APP_ID, this.env.GITHUB_APP_PRIVATE_KEY)}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new ValidationServiceError("GitHub App API request failed.", {
        status: response.status,
        body: await response.text(),
      });
    }

    return response.json() as Promise<unknown>;
  }
}

export function buildGitHubAppInstallUrl(input: {
  appSlug: string;
  state?: string;
}) {
  const appSlug = input.appSlug.trim();

  if (!/^[a-zA-Z0-9-]+$/.test(appSlug)) {
    throw new ValidationServiceError("Invalid GitHub App slug.");
  }

  const url = new URL(`https://github.com/apps/${appSlug}/installations/new`);

  if (input.state) {
    url.searchParams.set("state", input.state);
  }

  return url.toString();
}

export async function handleGitHubInstallationCallback(
  context: ScopedContext,
  input: {
    installationId: string;
    setupAction?: string;
    state?: string;
  },
  client: GitHubAppClient,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);

  if (!/^\d+$/.test(input.installationId)) {
    throw new ValidationServiceError("Invalid GitHub installation id.");
  }

  const info = await client.getInstallation(input.installationId);
  const installation = await db.githubInstallation.upsert({
    where: {
      installationId: info.installationId,
    },
    update: {
      orgId: context.orgId,
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      status: "CONNECTED",
      permissions: info.permissions ?? {},
      repositories: {
        repositorySelection: info.repositorySelection,
        repositories: info.repositories ?? [],
      },
    },
    create: {
      orgId: context.orgId,
      installationId: info.installationId,
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      status: "CONNECTED",
      permissions: info.permissions ?? {},
      repositories: {
        repositorySelection: info.repositorySelection,
        repositories: info.repositories ?? [],
      },
    },
  });

  await recordAuditEvent(
    context,
    {
      action: "github.installation.connected",
      entityType: "GithubInstallation",
      entityId: installation.id,
      metadata: {
        setupAction: input.setupAction,
        state: input.state,
        accountLogin: installation.accountLogin,
      },
    },
    db,
  );

  return installation;
}

export async function selectGitHubRepositoriesForProject(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
    repositories: GitHubRepositorySelection[];
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);
  await assertProjectPermission(context, input.projectId, "project.write", db);

  const installation = await getConnectedInstallation(context, input.installationId, db);
  const repositories = input.repositories.map((repository) => repositorySelectionSchema.parse(repository));
  const connections = [];

  for (const repository of repositories) {
    const externalId = `${installation.installationId}:${repository.fullName}`;
    const existing = await db.sourceConnection.findFirst({
      where: {
        orgId: context.orgId,
        projectId: input.projectId,
        provider: "GITHUB",
        externalId,
      },
    });
    const data = {
      orgId: context.orgId,
      projectId: input.projectId,
      provider: "GITHUB" as const,
      status: "CONNECTED" as const,
      externalId,
      displayName: repository.fullName,
      encryptedToken: null,
      metadata: {
        installationId: installation.installationId,
        repository,
        productionAuthPath: "github_app_installation_token_on_demand",
        selectedAt: new Date().toISOString(),
      } as Prisma.InputJsonObject,
    };

    connections.push(
      existing
        ? await db.sourceConnection.update({
            where: {
              id: existing.id,
            },
            data,
          })
        : await db.sourceConnection.create({
            data,
          }),
    );
  }

  await db.githubInstallation.update({
    where: {
      id: installation.id,
    },
    data: {
      repositories: {
        selectedForProjects: [
          {
            projectId: input.projectId,
            repositories,
            selectedAt: new Date().toISOString(),
          },
        ],
      },
    },
  });

  return connections;
}

export async function createGitHubInstallationToken(
  context: ScopedContext,
  input: {
    installationId: string;
    repositoryIds?: number[];
    permissions?: Record<string, string>;
  },
  client: GitHubAppClient,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);
  await getConnectedInstallation(context, input.installationId, db);

  return client.createInstallationAccessToken(input.installationId, {
    repositoryIds: input.repositoryIds,
    permissions: input.permissions,
  });
}

export async function disconnectGitHubInstallation(
  context: ScopedContext,
  input: {
    installationId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);
  const installation = await getConnectedInstallation(context, input.installationId, db);

  const disconnected = await db.githubInstallation.update({
    where: {
      id: installation.id,
    },
    data: {
      status: "DISCONNECTED",
      lastSyncedAt: new Date(),
    },
  });
  const connections = await db.sourceConnection.findMany({
    where: {
      orgId: context.orgId,
      provider: "GITHUB",
      externalId: {
        startsWith: `${installation.installationId}:`,
      },
    },
  });

  for (const connection of connections) {
    await db.sourceConnection.update({
      where: {
        id: connection.id,
      },
      data: {
        status: "DISCONNECTED",
        encryptedToken: null,
        metadata: {
          ...(isRecord(connection.metadata) ? connection.metadata : {}),
          historical: true,
          disconnectedAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
  }

  await recordAuditEvent(
    context,
    {
      action: "github.installation.disconnected",
      entityType: "GithubInstallation",
      entityId: installation.id,
      metadata: {
        accountLogin: installation.accountLogin,
      },
    },
    db,
  );

  return disconnected;
}

export function createGitHubAppJwt(appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");

  return `${signingInput}.${signature}`;
}

async function getConnectedInstallation(context: ScopedContext, installationId: string, db: DatabaseClient) {
  const installation = await db.githubInstallation.findFirst({
    where: {
      installationId,
      orgId: context.orgId,
      status: "CONNECTED",
    },
  });

  if (!installation) {
    throw new NotFoundError("GitHub installation not found.");
  }

  return installation;
}

function mapGitHubRepository(repository: Record<string, unknown>): GitHubRepositorySelection {
  return {
    id: Number(repository.id),
    name: String(repository.name ?? ""),
    fullName: String(repository.full_name ?? repository.fullName ?? ""),
    private: typeof repository.private === "boolean" ? repository.private : undefined,
    htmlUrl: typeof repository.html_url === "string" ? repository.html_url : undefined,
  };
}

function readStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationServiceError("Unexpected GitHub API response.");
  }

  return value;
}

function base64urlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
