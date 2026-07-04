import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { NotFoundError } from "@/services/errors";
import {
  createGitHubInstallationToken,
  type GitHubAppClient,
} from "@/services/github-app-service";
import { normalizeSourceDocument } from "@/services/source-normalization-service";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type GitHubPullRequestSummary = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  baseRef: string;
  headRef: string;
  htmlUrl: string;
  updatedAt?: string;
};

export type GitHubPullRequestDetail = GitHubPullRequestSummary & {
  body?: string | null;
  labels: string[];
  reviewers: string[];
  commentsSummary: string;
  checksSummary: string;
  commits: Array<{
    sha: string;
    message: string;
    htmlUrl?: string;
  }>;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
};

export type GitHubPullRequestClient = {
  listPullRequests(owner: string, repo: string, input: {
    branch?: string;
    state?: "open" | "closed" | "all";
    updatedSince?: string;
  }): Promise<GitHubPullRequestSummary[]>;
  getPullRequest(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequestDetail>;
};

export class GitHubRestPullRequestClient implements GitHubPullRequestClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listPullRequests(owner: string, repo: string, input: {
    branch?: string;
    state?: "open" | "closed" | "all";
    updatedSince?: string;
  }) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/pulls`);
    url.searchParams.set("state", input.state ?? "all");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "50");

    if (input.branch) {
      url.searchParams.set("base", input.branch);
    }

    const pulls = await this.githubJson(url.pathname + url.search);

    if (!Array.isArray(pulls)) {
      throw new Error("Unexpected GitHub pull request list response.");
    }

    return pulls
      .map((pull) => mapPullRequestSummary(assertRecord(pull)))
      .filter((pull) => !input.updatedSince || !pull.updatedAt || pull.updatedAt >= input.updatedSince);
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number) {
    const [pull, files, commits, reviews, comments] = await Promise.all([
      this.githubJson(`/repos/${owner}/${repo}/pulls/${pullNumber}`),
      this.githubJson(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`),
      this.githubJson(`/repos/${owner}/${repo}/pulls/${pullNumber}/commits?per_page=100`),
      this.githubJson(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews?per_page=100`),
      this.githubJson(`/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=100`),
    ]);
    const pullRecord = assertRecord(pull);
    const summary = mapPullRequestSummary(pullRecord);

    return {
      ...summary,
      body: typeof pullRecord.body === "string" ? pullRecord.body : null,
      labels: Array.isArray(pullRecord.labels)
        ? pullRecord.labels.map((label) => String(assertRecord(label).name ?? "")).filter(Boolean)
        : [],
      reviewers: Array.isArray(pullRecord.requested_reviewers)
        ? pullRecord.requested_reviewers.map((reviewer) => String(assertRecord(reviewer).login ?? "")).filter(Boolean)
        : [],
      commentsSummary: summarizeComments(Array.isArray(comments) ? comments : []),
      checksSummary: summarizeReviews(Array.isArray(reviews) ? reviews : []),
      commits: Array.isArray(commits)
        ? commits.map((commit) => {
            const record = assertRecord(commit);
            const commitRecord = assertRecord(record.commit);

            return {
              sha: String(record.sha ?? ""),
              message: String(commitRecord.message ?? ""),
              htmlUrl: typeof record.html_url === "string" ? record.html_url : undefined,
            };
          })
        : [],
      files: Array.isArray(files)
        ? files.map((file) => {
            const record = assertRecord(file);

            return {
              filename: String(record.filename ?? ""),
              status: String(record.status ?? "modified"),
              additions: Number(record.additions ?? 0),
              deletions: Number(record.deletions ?? 0),
              changes: Number(record.changes ?? 0),
              patch: typeof record.patch === "string" ? record.patch : undefined,
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

    if (!response.ok) {
      throw new Error(`GitHub pull request request failed: ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  }
}

export async function listGitHubPullRequestsForSelection(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
    owner: string;
    repo: string;
    branch?: string;
    state?: "open" | "closed" | "all";
    updatedSince?: string;
  },
  appClient: GitHubAppClient,
  pullRequestClientFactory: (token: string) => GitHubPullRequestClient,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.read", db);
  await assertConnectedRepository(context, input, db);

  const token = await createGitHubInstallationToken(
    context,
    {
      installationId: input.installationId,
      permissions: {
        contents: "read",
        pull_requests: "read",
        checks: "read",
      },
    },
    appClient,
    db,
  );

  return pullRequestClientFactory(token.token).listPullRequests(input.owner, input.repo, {
    branch: input.branch,
    state: input.state ?? "all",
    updatedSince: input.updatedSince,
  });
}

export async function importGitHubPullRequests(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
    owner: string;
    repo: string;
    pullRequestNumbers: number[];
  },
  appClient: GitHubAppClient,
  pullRequestClientFactory: (token: string) => GitHubPullRequestClient,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);
  await assertConnectedRepository(context, input, db);

  const token = await createGitHubInstallationToken(
    context,
    {
      installationId: input.installationId,
      permissions: {
        contents: "read",
        pull_requests: "read",
        checks: "read",
      },
    },
    appClient,
    db,
  );
  const client = pullRequestClientFactory(token.token);
  const selectedNumbers = [...new Set(input.pullRequestNumbers)];
  const imported = [];

  for (const pullNumber of selectedNumbers) {
    const pullRequest = await client.getPullRequest(input.owner, input.repo, pullNumber);
    const source = await createSourceDocument(
      context,
      {
        projectId: input.projectId,
        title: `PR #${pullRequest.number} ${pullRequest.title}`,
        body: renderPullRequestSource(`${input.owner}/${input.repo}`, pullRequest),
        sourceType: "GITHUB_PULL_REQUEST",
        tags: ["github", input.owner, input.repo, "pull-request", pullRequest.state],
        sourceCreatedAt: pullRequest.updatedAt ? new Date(pullRequest.updatedAt) : undefined,
        provenance: {
          kind: "github",
          externalId: String(pullRequest.number),
          externalUrl: pullRequest.htmlUrl,
          actor: pullRequest.reviewers[0],
          importedAt: new Date(),
        },
        metadata: {
          github: {
            installationId: input.installationId,
            repository: `${input.owner}/${input.repo}`,
            pullRequest,
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
      pullRequest,
    });
  }

  return {
    imported,
  };
}

function renderPullRequestSource(repositoryFullName: string, pullRequest: GitHubPullRequestDetail) {
  return [
    `# Pull Request #${pullRequest.number}: ${pullRequest.title}`,
    "",
    `Repository: ${repositoryFullName}`,
    `State: ${pullRequest.state}`,
    `Merged: ${pullRequest.merged ? "yes" : "no"}`,
    `Base: ${pullRequest.baseRef}`,
    `Head: ${pullRequest.headRef}`,
    `URL: ${pullRequest.htmlUrl}`,
    "",
    "## Body",
    pullRequest.body?.trim() || "[no body]",
    "",
    "## Labels",
    ...formatList(pullRequest.labels),
    "",
    "## Reviewers",
    ...formatList(pullRequest.reviewers),
    "",
    "## Comments summary",
    pullRequest.commentsSummary || "[no comments]",
    "",
    "## Checks summary",
    pullRequest.checksSummary || "[no checks]",
    "",
    "## Commits",
    ...pullRequest.commits.map((commit) => `- ${commit.sha}: ${commit.message}${commit.htmlUrl ? ` (${commit.htmlUrl})` : ""}`),
    "",
    "## Changed files",
    ...pullRequest.files.map((file) => `- ${file.filename} (${file.status}): +${file.additions} -${file.deletions} (${file.changes} changes)`),
    "",
    "## Patches",
    ...pullRequest.files.flatMap((file) => [
      `### ${file.filename}`,
      file.patch ?? "[binary or patch unavailable]",
      "",
    ]),
  ].join("\n");
}

function formatList(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

async function assertConnectedRepository(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
    owner: string;
    repo: string;
  },
  db: DatabaseClient,
) {
  const connection = await db.sourceConnection.findFirst({
    where: {
      orgId: context.orgId,
      projectId: input.projectId,
      provider: "GITHUB",
      status: "CONNECTED",
      externalId: `${input.installationId}:${input.owner}/${input.repo}`,
    },
  });

  if (!connection) {
    throw new NotFoundError("GitHub repository connection not found.");
  }

  return connection;
}

function mapPullRequestSummary(record: Record<string, unknown>): GitHubPullRequestSummary {
  const base = isRecord(record.base) ? record.base : {};
  const head = isRecord(record.head) ? record.head : {};

  return {
    number: Number(record.number),
    title: String(record.title ?? ""),
    state: record.state === "closed" ? "closed" : "open",
    merged: Boolean(record.merged),
    baseRef: String(base.ref ?? ""),
    headRef: String(head.ref ?? ""),
    htmlUrl: String(record.html_url ?? ""),
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
  };
}

function summarizeComments(comments: unknown[]) {
  if (comments.length === 0) {
    return "No issue comments.";
  }

  return `${comments.length} issue comment(s): ${comments
    .slice(0, 3)
    .map((comment) => String(assertRecord(comment).body ?? "").slice(0, 120))
    .join(" | ")}`;
}

function summarizeReviews(reviews: unknown[]) {
  if (reviews.length === 0) {
    return "No review records.";
  }

  return `${reviews.length} review record(s): ${reviews
    .slice(0, 3)
    .map((review) => String(assertRecord(review).state ?? "unknown"))
    .join(", ")}`;
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Unexpected GitHub pull request response.");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
