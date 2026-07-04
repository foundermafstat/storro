import { z } from "zod";

type EnvInput = Record<string, string | undefined>;

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function createPublicEnv(input: EnvInput = process.env): PublicEnv {
  const parsed = publicEnvSchema.safeParse(input);

  if (!parsed.success) {
    const missingOrInvalid = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid Storro public environment: ${missingOrInvalid}`);
  }

  return parsed.data;
}

export const publicEnvKeys = Object.keys(publicEnvSchema.shape);
