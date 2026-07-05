import { describe, expect, it } from "vitest";
import { evaluateAiArtifact } from "@/services/ai-evaluation-service";

const approvedFacts = [
  "Storro imports source notes and turns approved evidence into markdown artifacts.",
  "The export system creates markdown files from reviewed artifacts.",
];

describe("AI evaluation harness", () => {
  it("passes grounded artifacts", () => {
    const result = evaluateAiArtifact({
      approvedFacts,
      contentMarkdown: "## What shipped\n\nStorro imports source notes and turns approved evidence into markdown artifacts.",
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails on invented high-risk claims", () => {
    const result = evaluateAiArtifact({
      approvedFacts,
      contentMarkdown: "## What shipped\n\nStorro launched Stripe billing with 500 users.",
    });

    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.type === "invented_claim")).toBe(true);
  });

  it("fails on fake secrets", () => {
    const result = evaluateAiArtifact({
      approvedFacts,
      contentMarkdown: `## Evidence\n\nThe build log included sk-${"a".repeat(48)}.`,
    });

    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.type === "secret_leak")).toBe(true);
  });

  it("warns on generic phrasing", () => {
    const result = evaluateAiArtifact({
      approvedFacts,
      contentMarkdown: "## What shipped\n\nStorro imports source notes and turns approved evidence into markdown artifacts in a cutting-edge workflow.",
    });

    expect(result.passed).toBe(true);
    expect(result.issues.some((issue) => issue.type === "generic_phrasing")).toBe(true);
  });
});
