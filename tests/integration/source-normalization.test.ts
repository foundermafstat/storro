import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { createProject } from "@/services/project-service";
import { redactSourceDocument } from "@/services/redaction-service";
import type { ScopedContext } from "@/services/scoped-context";
import { createSourceDocument } from "@/services/source-service";
import { normalizeSourceDocument } from "@/services/source-normalization-service";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("source normalization service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `normalization-user-${suffix}`,
        email: `normalization-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `Normalization Org ${suffix}`,
        slug: `normalization-org-${suffix}`,
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
      name: `Normalization Project ${suffix}`,
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

  it("normalizes supported source types with privacy, provenance, ranking, and redacted text", async () => {
    const fakeSecret = "api_key=" + "n".repeat(20);
    const manual = await createSourceDocument(context, {
      projectId,
      title: "Manual normalization source",
      body: `Manual source ${fakeSecret}`,
      sourceType: "MANUAL_NOTE",
      tags: ["manual"],
      isPrivate: true,
      provenance: {
        kind: "manual_input",
      },
    });
    await redactSourceDocument(context, manual.id);

    const chatgpt = await createSourceDocument(context, {
      projectId,
      title: "chatgpt.json",
      body: JSON.stringify({ messages: ["ChatGPT export text"] }),
      sourceType: "CHATGPT_EXPORT",
      tags: ["chatgpt"],
      provenance: {
        kind: "chatgpt",
        externalId: "conv-1",
      },
    });
    const git = await createSourceDocument(context, {
      projectId,
      title: "git.diff",
      body: "diff --git a/app/page.tsx b/app/page.tsx\n+export default function Page() {}\n",
      sourceType: "GIT_DIFF",
      tags: ["git"],
      provenance: {
        kind: "cli",
      },
    });

    const results = await Promise.all([
      normalizeSourceDocument(context, manual.id),
      normalizeSourceDocument(context, chatgpt.id),
      normalizeSourceDocument(context, git.id),
    ]);

    expect(results[0].normalized.body).toContain("[REDACTED_SECRET_ASSIGNMENT]");
    expect(results[0].normalized.body).not.toContain(fakeSecret);
    expect(results[0].normalized.rankingScore).toBeGreaterThan(results[1].normalized.rankingScore);

    const shape = results.map((result) => ({
      sourceType: result.normalized.sourceType,
      isPrivate: result.normalized.isPrivate,
      rankingScore: result.normalized.rankingScore,
      body: result.normalized.body,
      metadata: stableMetadataShape(result.normalized.metadata),
    }));

    expect(shape).toMatchInlineSnapshot(`
      [
        {
          "body": "Manual source [REDACTED_SECRET_ASSIGNMENT]",
          "isPrivate": true,
          "metadata": {
            "parser": {
              "confidence": 0.92,
              "metadata": {
                "lineCount": 1,
                "parser": "plain-text",
              },
              "sections": [],
              "warnings": [],
            },
            "source": {
              "provenanceExternalId": undefined,
              "provenanceKind": "manual_input",
              "sourceType": "MANUAL_NOTE",
              "tags": [
                "manual",
              ],
            },
          },
          "rankingScore": 100,
          "sourceType": "MANUAL_NOTE",
        },
        {
          "body": "ChatGPT export text",
          "isPrivate": false,
          "metadata": {
            "parser": {
              "confidence": 0.84,
              "metadata": {
                "parser": "json",
                "rootType": "object",
              },
              "sections": [],
              "warnings": [],
            },
            "source": {
              "provenanceExternalId": "conv-1",
              "provenanceKind": "chatgpt",
              "sourceType": "CHATGPT_EXPORT",
              "tags": [
                "chatgpt",
              ],
            },
          },
          "rankingScore": 0,
          "sourceType": "CHATGPT_EXPORT",
        },
        {
          "body": "Files changed: 1
      Additions: 1
      Deletions: 0
      Commits: 0
      - app/page.tsx (+1/-0)",
          "isPrivate": false,
          "metadata": {
            "parser": {
              "confidence": 0.88,
              "metadata": {
                "git": {
                  "branches": [],
                  "commits": [],
                  "files": [
                    {
                      "additions": 1,
                      "deletions": 0,
                      "isBinary": false,
                      "isGenerated": false,
                      "isLockFile": false,
                      "isTestFile": false,
                      "path": "app/page.tsx",
                      "status": "modified",
                    },
                  ],
                  "summary": {
                    "additions": 1,
                    "binaryFiles": 0,
                    "collapsedFiles": {
                      "binary": [],
                      "generated": [],
                      "lock": [],
                    },
                    "deletions": 0,
                    "filesChanged": 1,
                    "generatedFiles": 0,
                    "lockFiles": 0,
                    "testFiles": 0,
                  },
                  "warnings": [],
                },
                "parser": "git-evidence",
              },
              "sections": [],
              "warnings": [],
            },
            "source": {
              "provenanceExternalId": undefined,
              "provenanceKind": "cli",
              "sourceType": "GIT_DIFF",
              "tags": [
                "git",
              ],
            },
          },
          "rankingScore": 0,
          "sourceType": "GIT_DIFF",
        },
      ]
    `);
  });

  it("does not normalize sources blocked by redaction", async () => {
    const privateKey = "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END " + "PRIVATE KEY-----";
    const source = await createSourceDocument(context, {
      projectId,
      title: "Blocked normalization source",
      body: privateKey,
      sourceType: "MANUAL_NOTE",
    });

    await redactSourceDocument(context, source.id);
    await expect(normalizeSourceDocument(context, source.id)).rejects.toThrow(
      "Source is blocked by redaction review.",
    );
  });
});

function stableMetadataShape(metadata: unknown) {
  const value = metadata as {
    source?: {
      sourceType?: string;
      tags?: string[];
      provenance?: {
        kind?: string;
        externalId?: string;
      };
    };
    parser?: unknown;
  };

  return {
    source: {
      sourceType: value.source?.sourceType,
      tags: value.source?.tags,
      provenanceKind: value.source?.provenance?.kind,
      provenanceExternalId: value.source?.provenance?.externalId,
    },
    parser: value.parser,
  };
}
