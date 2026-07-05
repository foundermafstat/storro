const required = ["APP_ENV", "DATABASE_URL", "REDIS_URL", "WORKER_BASE_URL"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Worker configuration missing: ${missing.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--health")) {
  console.log(JSON.stringify({ worker: "healthy", appEnv: process.env.APP_ENV }));
  process.exit(0);
}

console.log(JSON.stringify({
  event: "worker.started",
  appEnv: process.env.APP_ENV,
  workerBaseUrl: process.env.WORKER_BASE_URL,
}));

setInterval(() => {
  console.log(JSON.stringify({ event: "worker.heartbeat", at: new Date().toISOString() }));
}, 30_000);
