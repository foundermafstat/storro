import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { ingestLocalSnapshot } from "@/services/local-snapshot-ingest-service";

const bodySchema = z.object({
  projectId: z.string().uuid(),
  snapshot: z.object({
    note: z.string().min(1),
    status: z.string(),
    diffStat: z.string(),
    fullDiff: z.string().optional(),
    stagedDiff: z.string(),
    recentCommits: z.string(),
    branchInfo: z.string(),
    packageChanges: z.string(),
    privacy: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, request }) => {
    const source = await ingestLocalSnapshot(body, readBearerToken(request.headers.get("authorization")));

    return { source };
  },
});

function readBearerToken(value: string | null) {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }

  return value.slice("Bearer ".length);
}
