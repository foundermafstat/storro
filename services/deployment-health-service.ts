import { requiredServerEnvKeys } from "@/server/env";

export type DeploymentComponent = "web" | "worker" | "database" | "redis" | "object_storage" | "queue";

export type ComponentHealth = {
  component: DeploymentComponent;
  status: "healthy" | "degraded" | "down";
  message?: string;
};

export const deploymentComponents: DeploymentComponent[] = [
  "web",
  "worker",
  "database",
  "redis",
  "object_storage",
  "queue",
];

export function validateDeploymentConfig(env: Record<string, string | undefined>) {
  const missing = requiredServerEnvKeys.filter((key) => !env[key]);

  return {
    valid: missing.length === 0,
    missing,
    required: requiredServerEnvKeys,
    components: deploymentComponents,
  };
}

export function evaluateDeploymentHealth(checks: ComponentHealth[]) {
  const checked = new Set(checks.map((check) => check.component));
  const missing = deploymentComponents.filter((component) => !checked.has(component));
  const unhealthy = checks.filter((check) => check.status !== "healthy");

  return {
    ready: missing.length === 0 && unhealthy.length === 0,
    missing,
    unhealthy,
    checks,
  };
}
