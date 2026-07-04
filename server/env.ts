import { z } from "zod";

type EnvInput = Record<string, string | undefined>;

const appEnvSchema = z.enum(["development", "test", "staging", "production"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const redisUrlSchema = z.string().regex(/^rediss?:\/\//, "Must be a redis:// or rediss:// URL");

const serverEnvSchema = z.object({
  NODE_ENV: appEnvSchema.default("development"),
  APP_ENV: appEnvSchema,
  NEXT_PUBLIC_APP_URL: z.string().url(),
  WORKER_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: redisUrlSchema,

  OBJECT_STORAGE_ENDPOINT: z.string().url(),
  OBJECT_STORAGE_REGION: z.string().min(1),
  OBJECT_STORAGE_BUCKET: z.string().min(1),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_PUBLIC_BASE_URL: z.string().url(),

  AUTH_SECRET: z.string().min(32, "Must be at least 32 characters"),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO_MONTHLY: z.string().min(1),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_EXTRACTION: z.string().min(1),
  OPENAI_MODEL_GENERATION: z.string().min(1),

  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),

  ENCRYPTION_KEY: z.string().min(32, "Must be at least 32 characters"),
  LOG_LEVEL: logLevelSchema.default("info"),
  SENTRY_DSN: z.string().url().optional(),
  ANALYTICS_WRITE_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function createServerEnv(input: EnvInput = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(input);

  if (!parsed.success) {
    const missingOrInvalid = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid Storro server environment: ${missingOrInvalid}`);
  }

  return {
    ...parsed.data,
    GITHUB_APP_PRIVATE_KEY: parsed.data.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

export const requiredServerEnvKeys = Object.keys(serverEnvSchema.shape).filter(
  (key) => !["NODE_ENV", "LOG_LEVEL", "SENTRY_DSN", "ANALYTICS_WRITE_KEY"].includes(key),
);
