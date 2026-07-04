import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { IntegrationFailureError, NotFoundError, RateLimitError } from "@/services/errors";
import {
  createGitHubInstallationToken,
  type GitHubAppClient,
} from "@/services/github-app-service";
import { normalizeSourceDocument } from "@/services/source-normalization-service";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type GitHubRepositoryInfo = {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  description?: string | null;
};

export type GitHubBranchInfo = {
  name: string;
  sha: string;
};

export type GitHubCommitSummary = {
  sha: string;
};

export type GitHubCommitDetail = {
  sha: string;
  htmlUrl: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
  authorLogin?: string;
  authoredAt?: string;
  committedAt?: string;
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
  files: Array<{
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    changes?: number;
    patch?: string;
  }>;
};

export type GitHubRepositoryClient = {
  getRepository(owner: string, repo: string): Promise<GitHubRepositoryInfo>;
  listBranches(owner: string, repo: string): Promise<GitHubBranchInfo[]>;
  listCommits(owner: string, repo: string, input: { sha?: string; perPage: number }): Promise<GitHubCommitSummary[]>;
  getCommit(owner: string, repo: string, sha: string): Promise<GitHubCommitDetail>;
};

export class GitHubRestRepositoryClient implements GitHubRepositoryClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getRepository(owner: string, repo: string) {
    const payload = await this.githubJson(`/repos/${owner}/${repo}`);
    const record = assertRecord(payload);

    return {
      id: Number(record.id),
      name: String(record.name ?? repo),
      fullName: String(record.full_name ?? `${owner}/${repo}`),
      defaultBranch: String(record.default_branch ?? "main"),
      private: Boolean(record.private),
      htmlUrl: String(record.html_url ?? `https://github.com/${owner}/${repo}`),
      description: typeof record.description === "string" ? record.description : null,
    };
  }

  async listBranches(owner: string, repo: string) {
    const payload = await this.githubJson(`/repos/${owner}/${repo}/branches?per_page=100`);

    if (!Array.isArray(payload)) {
      throw new IntegrationFailureError("Unexpected GitHub branches response.");
    }

    return payload.map((branch) => {
      const record = assertRecord(branch);
      const commit = assertRecord(record.commit);

      return {
        name: String(record.name ?? ""),
        sha: String(commit.sha ?? ""),
      };
    });
  }

  async listCommits(owner: string, repo: string, input: { sha?: string; perPage: number }) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
    url.searchParams.set("per_page", String(input.perPage));

    if (input.sha) {
      url.searchParams.set("sha", input.sha);
    }

    const payload = await this.githubJson(url.pathname + url.search);

    if (!Array.isArray(payload)) {
      throw new IntegrationFailureError("Unexpected GitHub commits response.");
    }

    return payload.map((commit) => {
      const record = assertRecord(commit);

      return {
        sha: String(record.sha ?? ""),
      };
    });
  }

  async getCommit(owner: string, repo: string, sha: string) {
    const payload = await this.githubJson(`/repos/${owner}/${repo}/commits/${sha}`);
    const record = assertRecord(payload);
    const commit = assertRecord(record.commit);
    const author = assertRecord(commit.author);
    const committer = assertRecord(commit.committer);
    const stats = isRecord(record.stats) ? record.stats : {};

    return {
      sha: String(record.sha ?? sha),
      htmlUrl: String(record.html_url ?? `https://github.com/${owner}/${repo}/commit/${sha}`),
      message: String(commit.message ?? ""),
      authorName: typeof author.name === "string" ? author.name : undefined,
      authorEmail: typeof author.email === "string" ? author.email : undefined,
      authorLogin: isRecord(record.author) && typeof record.author.login === "string" ? record.author.login : undefined,
      authoredAt: typeof author.date === "string" ? author.date : undefined,
      committedAt: typeof committer.date === "string" ? committer.date : undefined,
      stats: {
        additions: typeof stats.additions === "number" ? stats.additions : undefined,
        deletions: typeof stats.deletions === "number" ? stats.deletions : undefined,
        total: typeof stats.total === "number" ? stats.total : undefined,
      },
      files: Array.isArray(record.files)
        ? record.files.map((file) => {
            const fileRecord = assertRecord(file);

            return {
              filename: String(fileRecord.filename ?? ""),
              status: typeof fileRecord.status === "string" ? fileRecord.status : undefined,
              additions: typeof fileRecord.additions === "number" ? fileRecord.additions : undefined,
              deletions: typeof fileRecord.deletions === "number" ? fileRecord.deletions : undefined,
              changes: typeof fileRecord.changes === "number" ? fileRecord.changes : undefined,
              patch: typeof fileRecord.patch === "string" ? fileRecord.patch : undefined,
            };
          })
        : [],
    };
  }

  private async githubJson(path: string) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
      },
    });

    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new RateLimitError("GitHub rate limit exceeded.", {
        resetAt: response.headers.get("x-ratelimit-reset"),
      });
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new IntegrationFailureError("GitHub repository permission error.", {
        status: response.status,
        body: await response.text(),
      });
    }

    if (!response.ok) {
      throw new IntegrationFailureError("GitHub repository request failed.", {
        status: response.status,
        body: await response.text(),
      });
    }

    return response.json() as Promise<unknown>;
  }
}

export async function importGitHubRepository(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
    owner: string;
    repo: string;
    branch?: string;
    maxCommits?: number;
  },
  appClient: GitHubAppClient,
  repositoryClientFactory: (token: string) => GitHubRepositoryClient,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);

  const fullName = `${input.owner}/${input.repo}`;
  const connection = await db.sourceConnection.findFirst({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      provider: "GITHUB",
      status: "CONNECTED",
      externalId: `${input.installationId}:${fullName}`,
    },
  });

  if (!connection) {
    throw new NotFoundError("GitHub repository connection not found.");
  }

  try {
    const token = await createGitHubInstallationToken(
      context,
      {
        installationId: input.installationId,
        permissions: {
          contents: "read",
          metadata: "read",
        },
      },
      appClient,
      db,
    );
    const client = repositoryClientFactory(token.token);
    const repository = await client.getRepository(input.owner, input.repo);
    const branches = await client.listBranches(input.owner, input.repo);
    const branch = input.branch ?? repository.defaultBranch;
    const commits = await client.listCommits(input.owner, input.repo, {
      sha: branch,
      perPage: input.maxCommits ?? 20,
    });
    const imported = [];

    for (const commit of commits) {
      const detail = await client.getCommit(input.owner, input.repo, commit.sha);
      const source = await createSourceDocument(
        context,
        {
          projectId: input.projectId,
          title: `${detail.sha.slice(0, 7)} ${firstLine(detail.message)}`,
          body: renderCommitSource(repository, branches, branch, detail),
          sourceType: "GITHUB_COMMIT",
          tags: ["github", input.owner, input.repo, branch],
          sourceCreatedAt: detail.committedAt ? new Date(detail.committedAt) : undefined,
          provenance: {
            kind: "github",
            externalId: detail.sha,
            externalUrl: detail.htmlUrl,
            actor: detail.authorLogin ?? detail.authorName,
            importedAt: new Date(),
          },
          metadata: {
            github: {
              repository,
              branches,
              selectedBranch: branch,
              commit: detail,
              installationId: input.installationId,
            },
          },
        },
        db,
      );
      const normalized = await normalizeSourceDocument(context, { sourceDocumentId: source.id, projectId: input.projectId }, undefined, db);

      imported.push({
        source,
        normalized: normalized.normalized,
        warnings: normalized.warnings,
      });
    }

    await db.sourceConnection.update({
      where: {
        id: connection.id,
      },
      data: {
        status: "CONNECTED",
        lastSyncedAt: new Date(),
        metadata: {
          ...(isRecord(connection.metadata) ? connection.metadata : {}),
          repository,
          branches,
          lastImport: {
            branch,
            commits: imported.length,
            importedAt: new Date().toISOString(),
          },
        },
      },
    });

    return {
      status: "IMPORTED" as const,
      repository,
      branches,
      imported,
    };
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof IntegrationFailureError) {
      const recoverable = error instanceof RateLimitError;

      await db.sourceConnection.update({
        where: {
          id: connection.id,
        },
        data: {
          status: "ERROR",
          metadata: {
            ...(isRecord(connection.metadata) ? connection.metadata : {}),
            lastError: {
              message: error.message,
              code: error.code,
              recoverable,
              recordedAt: new Date().toISOString(),
              details: toJsonSafe(error.details),
            },
          } as Prisma.InputJsonObject,
        },
      });

      return {
        status: recoverable ? "RECOVERABLE_ERROR" as const : "INTEGRATION_ERROR" as const,
        error,
        imported: [],
      };
    }

    throw error;
  }
}

function renderCommitSource(
  repository: GitHubRepositoryInfo,
  branches: GitHubBranchInfo[],
  branch: string,
  commit: GitHubCommitDetail,
) {
  return [
    `# Commit ${commit.sha}`,
    "",
    `Repository: ${repository.fullName}`,
    `Branch: ${branch}`,
    `URL: ${commit.htmlUrl}`,
    `Author: ${commit.authorLogin ?? commit.authorName ?? "unknown"} <${commit.authorEmail ?? "unknown"}>`,
    `Committed at: ${commit.committedAt ?? "unknown"}`,
    "",
    "## Message",
    commit.message,
    "",
    "## Stats",
    `Additions: ${commit.stats?.additions ?? 0}`,
    `Deletions: ${commit.stats?.deletions ?? 0}`,
    `Total changes: ${commit.stats?.total ?? 0}`,
    "",
    "## Files",
    ...commit.files.map((file) => `- ${file.filename} (${file.status ?? "modified"}): +${file.additions ?? 0} -${file.deletions ?? 0}`),
    "",
    "## Branches",
    ...branches.map((item) => `- ${item.name}: ${item.sha}`),
    "",
    "## Patches",
    ...commit.files.flatMap((file) => [
      `### ${file.filename}`,
      file.patch ?? "[binary or patch unavailable]",
      "",
    ]),
  ].join("\n");
}

function firstLine(message: string) {
  return message.split(/\r?\n/)[0]?.trim() || "GitHub commit";
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new IntegrationFailureError("Unexpected GitHub API response.");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toJsonSafe(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown> | string | number | boolean | null;
}
