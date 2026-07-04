import { Buffer } from "buffer";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertIntegrationManagement, assertProjectPermission } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { NotFoundError, ValidationServiceError } from "@/services/errors";
import {
  createGitHubInstallationToken,
  type GitHubAppClient,
} from "@/services/github-app-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type GitHubWriteAction =
  | "CREATE_RELEASE_DRAFT"
  | "CREATE_PR_COMMENT"
  | "UPSERT_CHANGELOG"
  | "PUBLISH_RELEASE_DRAFT";

export type GitHubWriteActionInput = {
  projectId: string;
  installationId: string;
  owner: string;
  repo: string;
  action: GitHubWriteAction;
  releaseTag?: string;
  releaseName?: string;
  releaseBody?: string;
  targetCommitish?: string;
  pullRequestNumber?: number;
  commentBody?: string;
  filePath?: string;
  fileContent?: string;
  commitMessage?: string;
  branch?: string;
  releaseId?: number;
  confirmed?: boolean;
};

export type GitHubWritePreview = {
  action: GitHubWriteAction;
  method: string;
  path: string;
  body: Record<string, unknown>;
  requiredPermissions: Record<string, "write">;
  permissionExplanation: string;
};

export type GitHubWriteClient = {
  createReleaseDraft(owner: string, repo: string, input: {
    tagName: string;
    name: string;
    body: string;
    targetCommitish?: string;
  }): Promise<unknown>;
  createPullRequestComment(owner: string, repo: string, input: {
    pullRequestNumber: number;
    body: string;
  }): Promise<unknown>;
  createOrUpdateFile(owner: string, repo: string, input: {
    path: string;
    content: string;
    message: string;
    branch?: string;
  }): Promise<unknown>;
  publishReleaseDraft(owner: string, repo: string, input: {
    releaseId: number;
  }): Promise<unknown>;
};

export class GitHubRestWriteClient implements GitHubWriteClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  createReleaseDraft(owner: string, repo: string, input: {
    tagName: string;
    name: string;
    body: string;
    targetCommitish?: string;
  }) {
    return this.githubJson("POST", `/repos/${owner}/${repo}/releases`, {
      tag_name: input.tagName,
      name: input.name,
      body: input.body,
      target_commitish: input.targetCommitish,
      draft: true,
    });
  }

  createPullRequestComment(owner: string, repo: string, input: {
    pullRequestNumber: number;
    body: string;
  }) {
    return this.githubJson("POST", `/repos/${owner}/${repo}/issues/${input.pullRequestNumber}/comments`, {
      body: input.body,
    });
  }

  createOrUpdateFile(owner: string, repo: string, input: {
    path: string;
    content: string;
    message: string;
    branch?: string;
  }) {
    return this.githubJson("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(input.path)}`, {
      message: input.message,
      content: Buffer.from(input.content).toString("base64"),
      branch: input.branch,
    });
  }

  publishReleaseDraft(owner: string, repo: string, input: {
    releaseId: number;
  }) {
    return this.githubJson("PATCH", `/repos/${owner}/${repo}/releases/${input.releaseId}`, {
      draft: false,
    });
  }

  private async githubJson(method: string, path: string, body: Record<string, unknown>) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new ValidationServiceError("GitHub write request failed.", {
        status: response.status,
        body: await response.text(),
      });
    }

    return response.json() as Promise<unknown>;
  }
}

export async function listGitHubWriteFeatures(
  context: ScopedContext,
  input: {
    projectId: string;
    installationId: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "artifact.read", db);
  const installation = await getScopedInstallation(context, input.installationId, db);
  const permissions = readPermissions(installation.permissions);

  return [
    feature("CREATE_RELEASE_DRAFT", hasWritePermission(permissions, "contents"), { contents: "write" }),
    feature("CREATE_PR_COMMENT", hasWritePermission(permissions, "pull_requests") || hasWritePermission(permissions, "issues"), { pull_requests: "write" }),
    feature("UPSERT_CHANGELOG", hasWritePermission(permissions, "contents"), { contents: "write" }),
    feature("PUBLISH_RELEASE_DRAFT", hasWritePermission(permissions, "contents"), { contents: "write" }),
  ];
}

export async function prepareGitHubWriteAction(
  context: ScopedContext,
  input: GitHubWriteActionInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertIntegrationManagement(context, db);
  await assertProjectPermission(context, input.projectId, "artifact.write", db);
  const installation = await getScopedInstallation(context, input.installationId, db);
  const preview = buildWritePreview(input);
  assertRequiredPermissions(readPermissions(installation.permissions), preview.requiredPermissions);

  return preview;
}

export async function executeGitHubWriteAction(
  context: ScopedContext,
  input: GitHubWriteActionInput,
  appClient: GitHubAppClient,
  writeClientFactory: (token: string) => GitHubWriteClient,
  db: DatabaseClient = prisma,
) {
  const preview = await prepareGitHubWriteAction(context, input, db);

  if (!input.confirmed) {
    throw new ValidationServiceError("GitHub write action requires explicit confirmation.");
  }

  const token = await createGitHubInstallationToken(
    context,
    {
      installationId: input.installationId,
      permissions: Object.fromEntries(Object.keys(preview.requiredPermissions).map((permission) => [permission, "write"])),
    },
    appClient,
    db,
  );
  const client = writeClientFactory(token.token);
  const result = await executePreparedAction(client, input);

  await recordAuditEvent(
    context,
    {
      action: "github.write.executed",
      entityType: "GitHubRepository",
      entityId: `${input.owner}/${input.repo}`,
      projectId: input.projectId,
      metadata: {
        preview,
        result,
      },
    },
    db,
  );

  return {
    preview,
    result,
  };
}

function buildWritePreview(input: GitHubWriteActionInput): GitHubWritePreview {
  switch (input.action) {
    case "CREATE_RELEASE_DRAFT":
      requireFields(input, ["releaseTag", "releaseName", "releaseBody"]);
      return {
        action: input.action,
        method: "POST",
        path: `/repos/${input.owner}/${input.repo}/releases`,
        body: {
          tag_name: input.releaseTag,
          name: input.releaseName,
          body: input.releaseBody,
          target_commitish: input.targetCommitish,
          draft: true,
        },
        requiredPermissions: { contents: "write" },
        permissionExplanation: "Creating release drafts requires GitHub App contents:write permission.",
      };
    case "CREATE_PR_COMMENT":
      requireFields(input, ["pullRequestNumber", "commentBody"]);
      return {
        action: input.action,
        method: "POST",
        path: `/repos/${input.owner}/${input.repo}/issues/${input.pullRequestNumber}/comments`,
        body: { body: input.commentBody },
        requiredPermissions: { pull_requests: "write" },
        permissionExplanation: "Opening PR comments requires pull_requests:write or issues:write permission.",
      };
    case "UPSERT_CHANGELOG":
      requireFields(input, ["filePath", "fileContent", "commitMessage"]);
      return {
        action: input.action,
        method: "PUT",
        path: `/repos/${input.owner}/${input.repo}/contents/${input.filePath}`,
        body: {
          message: input.commitMessage,
          contentBase64Preview: Buffer.from(input.fileContent ?? "").toString("base64"),
          branch: input.branch,
        },
        requiredPermissions: { contents: "write" },
        permissionExplanation: "Creating or updating changelog files requires contents:write permission.",
      };
    case "PUBLISH_RELEASE_DRAFT":
      requireFields(input, ["releaseId"]);
      return {
        action: input.action,
        method: "PATCH",
        path: `/repos/${input.owner}/${input.repo}/releases/${input.releaseId}`,
        body: { draft: false },
        requiredPermissions: { contents: "write" },
        permissionExplanation: "Publishing a release draft requires contents:write permission.",
      };
  }
}

function executePreparedAction(client: GitHubWriteClient, input: GitHubWriteActionInput) {
  switch (input.action) {
    case "CREATE_RELEASE_DRAFT":
      return client.createReleaseDraft(input.owner, input.repo, {
        tagName: input.releaseTag ?? "",
        name: input.releaseName ?? "",
        body: input.releaseBody ?? "",
        targetCommitish: input.targetCommitish,
      });
    case "CREATE_PR_COMMENT":
      return client.createPullRequestComment(input.owner, input.repo, {
        pullRequestNumber: input.pullRequestNumber ?? 0,
        body: input.commentBody ?? "",
      });
    case "UPSERT_CHANGELOG":
      return client.createOrUpdateFile(input.owner, input.repo, {
        path: input.filePath ?? "",
        content: input.fileContent ?? "",
        message: input.commitMessage ?? "",
        branch: input.branch,
      });
    case "PUBLISH_RELEASE_DRAFT":
      return client.publishReleaseDraft(input.owner, input.repo, {
        releaseId: input.releaseId ?? 0,
      });
  }
}

async function getScopedInstallation(context: ScopedContext, installationId: string, db: DatabaseClient) {
  const installation = await db.githubInstallation.findFirst({
    where: {
      orgId: context.orgId,
      installationId,
      status: "CONNECTED",
    },
  });

  if (!installation) {
    throw new NotFoundError("GitHub installation not found.");
  }

  return installation;
}

function assertRequiredPermissions(current: Record<string, string>, required: Record<string, "write">) {
  const missing = Object.keys(required).filter((permission) => {
    if (permission === "pull_requests") {
      return !hasWritePermission(current, "pull_requests") && !hasWritePermission(current, "issues");
    }

    return !hasWritePermission(current, permission);
  });

  if (missing.length > 0) {
    throw new ValidationServiceError("GitHub write permission not granted.", {
      missing,
      required,
    });
  }
}

function hasWritePermission(permissions: Record<string, string>, permission: string) {
  return permissions[permission] === "write" || permissions[permission] === "admin";
}

function readPermissions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function feature(action: GitHubWriteAction, available: boolean, requiredPermissions: Record<string, "write">) {
  return {
    action,
    available,
    requiredPermissions,
  };
}

function requireFields(input: GitHubWriteActionInput, fields: Array<keyof GitHubWriteActionInput>) {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === "");

  if (missing.length > 0) {
    throw new ValidationServiceError("Missing GitHub write action fields.", {
      missing,
    });
  }
}
