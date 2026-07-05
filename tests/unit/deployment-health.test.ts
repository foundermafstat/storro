import { access } from "fs/promises";
import { describe, expect, it } from "vitest";
import {
  deploymentComponents,
  evaluateDeploymentHealth,
  validateDeploymentConfig,
} from "@/services/deployment-health-service";

const completeEnv = Object.fromEntries([
  "APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "WORKER_BASE_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_PUBLIC_BASE_URL",
  "AUTH_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_TEAM_MONTHLY",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_EXTRACTION",
  "OPENAI_MODEL_GENERATION",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "ENCRYPTION_KEY",
].map((key) => [key, `${key.toLowerCase()}_value`]));

describe("deployment health", () => {
  it("validates typed production config coverage", () => {
    const valid = validateDeploymentConfig(completeEnv);
    const invalid = validateDeploymentConfig({ APP_ENV: "production" });

    expect(valid.valid).toBe(true);
    expect(valid.components).toEqual(deploymentComponents);
    expect(invalid.valid).toBe(false);
    expect(invalid.missing).toContain("DATABASE_URL");
  });

  it("requires all production components to be healthy", () => {
    const ready = evaluateDeploymentHealth(deploymentComponents.map((component) => ({ component, status: "healthy" as const })));
    const missingQueue = evaluateDeploymentHealth(deploymentComponents.filter((component) => component !== "queue").map((component) => ({ component, status: "healthy" as const })));
    const degraded = evaluateDeploymentHealth(deploymentComponents.map((component) => ({ component, status: component === "redis" ? "down" as const : "healthy" as const })));

    expect(ready.ready).toBe(true);
    expect(missingQueue.ready).toBe(false);
    expect(missingQueue.missing).toEqual(["queue"]);
    expect(degraded.ready).toBe(false);
    expect(degraded.unhealthy[0]).toMatchObject({ component: "redis" });
  });

  it("documents deployment, rollback, backup, and restore procedures", async () => {
    await expect(access("docs/operations/deployment-infrastructure.md")).resolves.toBeUndefined();
    await expect(access("docs/operations/rollback-backup-restore.md")).resolves.toBeUndefined();
  });
});
