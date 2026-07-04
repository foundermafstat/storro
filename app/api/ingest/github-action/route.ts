import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { createServerEnv } from "@/server/env";
import { createObjectStorageAdapterFromEnv } from "@/services/file-upload-service";
import { ingestGitHubActionArtifact } from "@/services/github-action-ingest-service";

const bodySchema = z.object({
  projectId: z.string().uuid(),
  repository: z.string().min(1),
  runId: z.string().min(1),
  runAttempt: z.string().optional(),
  sha: z.string().min(7),
  ref: z.string().min(1),
  pullRequestNumber: z.number().int().positive().optional(),
  diffStat: z.string(),
  fullDiff: z.string().optional(),
  testResults: z.string().optional(),
  changedFiles: z.array(z.string()),
  dependencyChanges: z.string().optional(),
  migrationSummary: z.string().optional(),
  ciContext: z.string(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, request }) => {
    const env = createServerEnv();
    const authToken = readBearerToken(request.headers.get("authorization"));
    const result = await ingestGitHubActionArtifact(
      body,
      authToken,
      createObjectStorageAdapterFromEnv(env),
    );

    return result;
  },
});

function readBearerToken(value: string | null) {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }

  return value.slice("Bearer ".length);
}
