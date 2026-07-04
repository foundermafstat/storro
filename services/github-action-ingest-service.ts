import { createHash, randomBytes, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { AuthenticationError, NotFoundError } from "@/services/errors";
import type { ObjectStorageAdapter } from "@/services/file-upload-service";
import { calculateSha256 } from "@/services/file-upload-service";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export const maxInlineGithubActionDiffBytes = 64 * 1024;

export type GitHubActionIngestPayload = {
  projectId: string;
  repository: string;
  runId: string;
  runAttempt?: string;
  sha: string;
  ref: string;
  pullRequestNumber?: number;
  diffStat: string;
  fullDiff?: string;
  testResults?: string;
  changedFiles: string[];
  dependencyChanges?: string;
  migrationSummary?: string;
  ciContext: string;
};

export async function createGitHubActionIngestToken(
  context: ScopedContext,
  input: {
    projectId: string;
    label: string;
  },
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "integration.manage", db);
  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      orgId: context.orgId,
    },
  });

  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  const token = `storro_ingest_${randomBytes(24).toString("base64url")}`;
  const tokenRecord = {
    id: randomUUID(),
    label: input.label,
    tokenHash: hashToken(token),
    createdById: context.userId,
    createdAt: new Date().toISOString(),
  };

  await db.project.update({
    where: {
      id: project.id,
    },
    data: {
      metadata: {
        ...(isRecord(project.metadata) ? project.metadata : {}),
        ingestTokens: [...readIngestTokens(project.metadata), tokenRecord],
      } as Prisma.InputJsonObject,
    },
  });

  return {
    token,
    tokenRecord: {
      ...tokenRecord,
      tokenHash: undefined,
    },
  };
}

export async function ingestGitHubActionArtifact(
  input: GitHubActionIngestPayload,
  authToken: string | undefined,
  storage: ObjectStorageAdapter,
  db: DatabaseClient = prisma,
) {
  if (!authToken) {
    throw new AuthenticationError("GitHub Action ingest token is required.");
  }

  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      archivedAt: null,
    },
  });

  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  assertValidIngestToken(project.metadata, authToken);

  const diffBytes = new TextEncoder().encode(input.fullDiff ?? "");
  const shouldStoreDiff = diffBytes.byteLength > maxInlineGithubActionDiffBytes;
  const diffObjectKey = shouldStoreDiff
    ? createDiffObjectKey(project.orgId, project.id, input.repository, input.sha)
    : undefined;

  if (shouldStoreDiff && input.fullDiff) {
    await storage.putObject({
      objectKey: diffObjectKey ?? "",
      body: diffBytes,
      mimeType: "text/plain",
      checksumSha256: calculateSha256(diffBytes),
      metadata: {
        orgId: project.orgId,
        projectId: project.id,
        repository: input.repository,
        sha: input.sha,
      },
    });
  }

  const source = await createSourceDocument(
    {
      orgId: project.orgId,
      userId: project.ownerId,
    },
    {
      projectId: project.id,
      title: `GitHub Action context ${input.repository}@${input.sha.slice(0, 7)}`,
      body: renderIngestSource(input, shouldStoreDiff),
      rawObjectKey: diffObjectKey,
      sourceType: "CLI_SNAPSHOT",
      tags: ["github-action", input.repository, input.ref],
      provenance: {
        kind: "github",
        externalId: input.runId,
        externalUrl: `https://github.com/${input.repository}/actions/runs/${input.runId}`,
        importedAt: new Date(),
      },
      metadata: {
        githubAction: {
          ...input,
          fullDiff: shouldStoreDiff ? undefined : input.fullDiff,
          diffObjectKey,
        },
      },
    },
    db,
  );

  return {
    source,
    diffObjectKey,
  };
}

function renderIngestSource(input: GitHubActionIngestPayload, diffStoredExternally: boolean) {
  return [
    "# GitHub Action CI context",
    "",
    `Repository: ${input.repository}`,
    `Run ID: ${input.runId}`,
    `Run attempt: ${input.runAttempt ?? "unknown"}`,
    `SHA: ${input.sha}`,
    `Ref: ${input.ref}`,
    `Pull request: ${input.pullRequestNumber ?? "none"}`,
    "",
    "## CI context",
    input.ciContext,
    "",
    "## Diff stat",
    input.diffStat,
    "",
    "## Changed files",
    ...input.changedFiles.map((file) => `- ${file}`),
    "",
    "## Test results",
    input.testResults ?? "not provided",
    "",
    "## Dependency changes",
    input.dependencyChanges ?? "not provided",
    "",
    "## Migration summary",
    input.migrationSummary ?? "not provided",
    "",
    "## Full diff",
    diffStoredExternally ? "[stored in object storage]" : input.fullDiff ?? "not provided",
  ].join("\n");
}

function assertValidIngestToken(metadata: Prisma.JsonValue, token: string) {
  const tokenHash = hashToken(token);
  const match = readIngestTokens(metadata).find((item) => item.tokenHash === tokenHash && !item.revokedAt);

  if (!match) {
    throw new AuthenticationError("Invalid GitHub Action ingest token.");
  }
}

function readIngestTokens(metadata: Prisma.JsonValue) {
  if (!isRecord(metadata) || !Array.isArray(metadata.ingestTokens)) {
    return [];
  }

  return metadata.ingestTokens.filter(isRecord) as Array<{
    id: string;
    label: string;
    tokenHash: string;
    revokedAt?: string;
  }>;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createDiffObjectKey(orgId: string, projectId: string, repository: string, sha: string) {
  return [
    "orgs",
    orgId,
    "projects",
    projectId,
    "github-action",
    `${repository.replace(/[^a-zA-Z0-9._-]/g, "-")}-${sha}-${Date.now()}.diff`,
  ].join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
