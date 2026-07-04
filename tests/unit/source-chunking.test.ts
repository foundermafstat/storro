import { describe, expect, it } from "vitest";
import {
  createSourceChunks,
  estimateTokens,
  rankNormalizedSourcesForExtraction,
  shouldExcludeFromChunking,
} from "@/services/source-chunking-service";

const largeDiff = [
  "diff --git a/app/page.tsx b/app/page.tsx",
  "+".repeat(180),
  "diff --git a/tests/page.test.ts b/tests/page.test.ts",
  "+".repeat(180),
].join("\n");

describe("source chunking and ranking", () => {
  it("splits large diffs into stable token-bounded chunks", () => {
    const chunks = createSourceChunks(
      {
        sourceType: "GIT_DIFF",
        title: "large.diff",
        body: largeDiff,
      },
      { maxTokens: 32 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 32)).toBe(true);
  });

  it("ranks manual notes and PR bodies before raw patches", () => {
    const ranked = rankNormalizedSourcesForExtraction([
      {
        sourceType: "GIT_DIFF",
        title: "raw.patch",
        body: "diff --git",
        rankingScore: 0,
      },
      {
        sourceType: "GITHUB_PULL_REQUEST",
        title: "PR body",
        body: "Implementation details",
        rankingScore: 10,
      },
      {
        sourceType: "MANUAL_NOTE",
        title: "Daily journal",
        body: "Human context",
        rankingScore: 0,
      },
    ]);

    expect(ranked.map((source) => source.title)).toEqual(["Daily journal", "PR body", "raw.patch"]);
  });

  it("excludes generated-only git evidence", () => {
    expect(
      shouldExcludeFromChunking({
        sourceType: "GIT_DIFF",
        title: "generated.diff",
        body: "generated",
        metadata: {
          parser: {
            metadata: {
              git: {
                summary: {
                  filesChanged: 2,
                  generatedFiles: 2,
                  testFiles: 0,
                },
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("keeps chunks inside token budget limits", () => {
    const chunks = createSourceChunks(
      {
        sourceType: "MANUAL_NOTE",
        title: "long note",
        body: Array.from({ length: 20 }, (_, index) => `## Section ${index}\n${"word ".repeat(80)}`).join("\n\n"),
      },
      { maxTokens: 60 },
    );

    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((chunk) => estimateTokens(chunk.body) <= 60)).toBe(true);
  });
});
