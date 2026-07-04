import { describe, expect, it } from "vitest";
import { redactText } from "@/services/redaction-service";

describe("redaction service", () => {
  it("detects and redacts fake API keys, GitHub tokens, JWTs, and database URLs", () => {
    const openAiKey = "sk-" + "proj-" + "a".repeat(28);
    const githubToken = "ghp_" + "b".repeat(32);
    const jwt = "eyJ" + "c".repeat(16) + "." + "d".repeat(16) + "." + "e".repeat(16);
    const databaseUrl = "postgres://" + "user:pass@localhost:5432/storro";
    const result = redactText(`keys ${openAiKey} ${githubToken} ${jwt} ${databaseUrl}`);

    expect(result.redactedText).not.toContain(openAiKey);
    expect(result.redactedText).not.toContain(githubToken);
    expect(result.redactedText).not.toContain(jwt);
    expect(result.redactedText).not.toContain(databaseUrl);
    expect(result.findings.map((finding) => finding.type)).toEqual([
      "openai_key",
      "github_token",
      "jwt",
      "database_url",
    ]);
    expect(result.blocked).toBe(true);
  });

  it("blocks private keys and seed phrases by default", () => {
    const privateKey = "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END " + "PRIVATE KEY-----";
    const seedPhrase = "seed phrase: alpha beta gamma delta eagle forest garden harbor island jungle kitten lemon";
    const result = redactText(`${privateKey}\n${seedPhrase}`);

    expect(result.blocked).toBe(true);
    expect(result.requiresReview).toBe(true);
    expect(result.findings.map((finding) => finding.type)).toEqual(["private_key", "seed_phrase"]);
  });
});
