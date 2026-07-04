import { createHash } from "crypto";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { AuthenticationError, NotFoundError } from "@/services/errors";
import { createSourceDocument } from "@/services/source-service";

export async function ingestLocalSnapshot(
  input: {
    projectId: string;
    snapshot: {
      note: string;
      status: string;
      diffStat: string;
      fullDiff?: string;
      stagedDiff: string;
      recentCommits: string;
      branchInfo: string;
      packageChanges: string;
      privacy?: Record<string, unknown>;
    };
  },
  authToken: string | undefined,
  db: DatabaseClient = prisma,
) {
  if (!authToken) {
    throw new AuthenticationError("Local snapshot token is required.");
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

  assertValidToken(project.metadata, authToken);

  return createSourceDocument(
    {
      orgId: project.orgId,
      userId: project.ownerId,
    },
    {
      projectId: project.id,
      title: `Local snapshot ${input.snapshot.branchInfo || "workspace"}`,
      body: renderSnapshot(input.snapshot),
      sourceType: "CLI_SNAPSHOT",
      tags: ["local-snapshot", input.snapshot.branchInfo].filter(Boolean),
      provenance: {
        kind: "cli",
        actor: "storro snapshot",
        importedAt: new Date(),
      },
      metadata: {
        localSnapshot: input.snapshot,
      },
      isPrivate: true,
    },
    db,
  );
}

function renderSnapshot(snapshot: {
  note: string;
  status: string;
  diffStat: string;
  fullDiff?: string;
  stagedDiff: string;
  recentCommits: string;
  branchInfo: string;
  packageChanges: string;
}) {
  return [
    "# Local snapshot",
    "",
    "## User note",
    snapshot.note,
    "",
    "## Branch",
    snapshot.branchInfo,
    "",
    "## Git status",
    snapshot.status || "clean",
    "",
    "## Diff stat",
    snapshot.diffStat || "none",
    "",
    "## Staged diff",
    snapshot.stagedDiff || "none",
    "",
    "## Recent commits",
    snapshot.recentCommits || "none",
    "",
    "## Package changes",
    snapshot.packageChanges || "none",
    "",
    "## Full diff",
    snapshot.fullDiff ?? "not included",
  ].join("\n");
}

function assertValidToken(metadata: unknown, token: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new AuthenticationError("Invalid local snapshot token.");
  }

  const record = metadata as { ingestTokens?: unknown[] };

  if (!Array.isArray(record.ingestTokens)) {
    throw new AuthenticationError("Invalid local snapshot token.");
  }

  const hash = createHash("sha256").update(token).digest("hex");
  const valid = record.ingestTokens
    .filter((item): item is { tokenHash: string; revokedAt?: string } => {
      return !!item && typeof item === "object" && "tokenHash" in item;
    })
    .some((item) => item.tokenHash === hash && !item.revokedAt);

  if (!valid) {
    throw new AuthenticationError("Invalid local snapshot token.");
  }
}
