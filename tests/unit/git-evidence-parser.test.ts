import { describe, expect, it } from "vitest";
import { parseSourceDocumentContent } from "@/services/source-parser-service";
import { formatGitEvidenceSummary, parseGitEvidence } from "@/services/git-evidence-parser";

const sampleDiff = `commit abcdef1234567890
Author: Dev <dev@storro.local>
Date:   Sat Jul 4 00:00:00 2026 +0000

    Add source parser

diff --git a/services/source-parser-service.ts b/services/source-parser-service.ts
index 1111111..2222222 100644
--- a/services/source-parser-service.ts
+++ b/services/source-parser-service.ts
@@ -1,2 +1,4 @@
 import type { Prisma } from "@prisma/client";
+import { parseGitEvidence } from "@/services/git-evidence-parser";
 const parser = true;
-const oldValue = false;
+const newValue = true;
diff --git a/package-lock.json b/package-lock.json
index 3333333..4444444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1,2 @@
 {}
+{"lockfileVersion": 3}
diff --git a/public/logo.png b/public/logo.png
Binary files differ
`;

describe("git evidence parser", () => {
  it("extracts changed files, commits, lock files, binary files, and summaries from diffs", () => {
    const parsed = parseGitEvidence(sampleDiff);

    expect(parsed.commits).toEqual([
      {
        sha: "abcdef1234567890",
        author: "Dev <dev@storro.local>",
        date: "Sat Jul 4 00:00:00 2026 +0000",
        message: "Add source parser",
      },
    ]);
    expect(parsed.files.map((file) => file.path)).toEqual([
      "services/source-parser-service.ts",
      "package-lock.json",
      "public/logo.png",
    ]);
    expect(parsed.summary.lockFiles).toBe(1);
    expect(parsed.summary.binaryFiles).toBe(1);
    expect(parsed.summary.additions).toBeGreaterThan(0);
    expect(formatGitEvidenceSummary(parsed)).toContain("Collapsed lock files: 1");
  });

  it("parses git numstat and test file paths", () => {
    const parsed = parseGitEvidence("12\t3\ttests/unit/git-evidence-parser.test.ts\n4\t0\tdist/generated.js");

    expect(parsed.summary.filesChanged).toBe(2);
    expect(parsed.summary.testFiles).toBe(1);
    expect(parsed.summary.generatedFiles).toBe(1);
  });

  it("parses commit logs and branches", () => {
    const parsed = parseGitEvidence(`On branch main
commit 1234567890abcdef
Author: Dev <dev@storro.local>
Date:   Sat Jul 4 00:00:00 2026 +0000

    Ship parser
`);

    expect(parsed.branches).toEqual(["main"]);
    expect(parsed.commits[0]).toMatchObject({
      sha: "1234567890abcdef",
      message: "Ship parser",
    });
  });

  it("returns warnings for malformed non-git input", () => {
    const parsed = parseGitEvidence("hello world");

    expect(parsed.files).toEqual([]);
    expect(parsed.commits).toEqual([]);
    expect(parsed.warnings).toEqual(["No git diff, git show, or git log evidence was detected."]);
  });

  it("is used by the source parser registry for git diff sources", async () => {
    const result = await parseSourceDocumentContent({
      sourceType: "GIT_DIFF",
      title: "git.diff",
      rawText: sampleDiff,
    });

    expect(result.metadata).toMatchObject({
      git: {
        summary: {
          lockFiles: 1,
          binaryFiles: 1,
        },
      },
    });
    expect(result.text).toContain("services/source-parser-service.ts");
  });
});
