import { describe, expect, it } from "vitest";
import { createPublicEnv, publicEnvKeys } from "@/lib/public-env";
import { createServerEnv, requiredServerEnvKeys } from "@/server/env";

const validEnv = {
  NODE_ENV: "test",
  APP_ENV: "test",
  NEXT_PUBLIC_APP_URL: "https://storro.example",
  WORKER_BASE_URL: "https://worker.storro.example",
  DATABASE_URL: "postgresql://localhost:5432/storro",
  REDIS_URL: "redis://localhost:6379",
  OBJECT_STORAGE_ENDPOINT: "https://storage.example",
  OBJECT_STORAGE_REGION: "auto",
  OBJECT_STORAGE_BUCKET: "storro-test",
  OBJECT_STORAGE_ACCESS_KEY_ID: "access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret-key",
  OBJECT_STORAGE_PUBLIC_BASE_URL: "https://cdn.storro.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  AUTH_GITHUB_ID: "github-oauth-client-id",
  AUTH_GITHUB_SECRET: "github-oauth-client-secret",
  STRIPE_SECRET_KEY: "sk_test_stripe",
  STRIPE_WEBHOOK_SECRET: "whsec_stripe",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro",
  STRIPE_PRICE_TEAM_MONTHLY: "price_team",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "escaped-github-private-key-line-one\\nline-two",
  GITHUB_APP_WEBHOOK_SECRET: "github-webhook-secret",
  GITHUB_APP_CLIENT_ID: "github-client-id",
  GITHUB_APP_CLIENT_SECRET: "github-client-secret",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  LOG_LEVEL: "info",
} satisfies Record<string, string>;

describe("environment contract", () => {
  it("parses a complete server environment", () => {
    const env = createServerEnv(validEnv);

    expect(env.APP_ENV).toBe("test");
    expect(env.GITHUB_APP_PRIVATE_KEY).toContain("\n");
    expect(requiredServerEnvKeys).toContain("DATABASE_URL");
    expect(requiredServerEnvKeys).toContain("OPENAI_API_KEY");
  });

  it("fails clearly when required server variables are missing", () => {
    expect(() => createServerEnv({ APP_ENV: "test" })).toThrow(
      /Invalid Storro server environment: .*DATABASE_URL/,
    );
  });

  it("parses only public client-safe variables", () => {
    const env = createPublicEnv(validEnv);

    expect(env).toEqual({
      NEXT_PUBLIC_APP_URL: "https://storro.example",
    });
    expect(publicEnvKeys.every((key) => key.startsWith("NEXT_PUBLIC_"))).toBe(true);
    expect(Object.keys(env)).not.toContain("OPENAI_API_KEY");
    expect(Object.keys(env)).not.toContain("DATABASE_URL");
  });
});
