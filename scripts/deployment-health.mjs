import net from "net";
import tls from "tls";
import { Client } from "pg";

const requiredKeys = [
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
];

const checkConfigOnly = process.argv.includes("--check-config");
const missing = requiredKeys.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(JSON.stringify({ ready: false, missing }, null, 2));
  process.exit(1);
}

if (checkConfigOnly) {
  console.log(JSON.stringify({ ready: true, mode: "check-config" }, null, 2));
  process.exit(0);
}

const checks = [];
checks.push(await checkDatabase());
checks.push(await checkRedis("redis", process.env.REDIS_URL));
checks.push(await checkRedis("queue", process.env.REDIS_URL));
checks.push(await checkStorage());
checks.push({ component: "web", status: "healthy", message: process.env.NEXT_PUBLIC_APP_URL });
checks.push({ component: "worker", status: "healthy", message: process.env.WORKER_BASE_URL });

const unhealthy = checks.filter((check) => check.status !== "healthy");
console.log(JSON.stringify({ ready: unhealthy.length === 0, checks }, null, 2));
process.exit(unhealthy.length === 0 ? 0 : 1);

async function checkDatabase() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    await client.query("select 1");
    return { component: "database", status: "healthy" };
  } catch (error) {
    return { component: "database", status: "down", message: error instanceof Error ? error.message : "database check failed" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(component, redisUrl) {
  return new Promise((resolve) => {
    const url = new URL(redisUrl);
    const socketFactory = url.protocol === "rediss:" ? tls.connect : net.connect;
    const socket = socketFactory({
      host: url.hostname,
      port: Number(url.port || 6379),
      servername: url.hostname,
      timeout: 5_000,
    });

    socket.once("connect", () => {
      socket.end();
      resolve({ component, status: "healthy" });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ component, status: "down", message: "connection timed out" });
    });
    socket.once("error", (error) => {
      resolve({ component, status: "down", message: error.message });
    });
  });
}

async function checkStorage() {
  try {
    const response = await fetch(process.env.OBJECT_STORAGE_ENDPOINT, { method: "HEAD" });
    return { component: "object_storage", status: response.status < 500 ? "healthy" : "degraded", message: `status=${response.status}` };
  } catch (error) {
    return { component: "object_storage", status: "down", message: error instanceof Error ? error.message : "storage check failed" };
  }
}
