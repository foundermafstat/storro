import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createArtifactExportDownloadUrl } from "@/services/artifact-export-service";
import { createObjectStorageAdapterFromEnv } from "@/services/file-upload-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  exportId: z.string().uuid(),
});

const querySchema = z
  .object({
    expiresInSeconds: z.string().optional(),
  })
  .transform((query) => ({
    expiresInSeconds: query.expiresInSeconds ? Number(query.expiresInSeconds) : undefined,
  }));

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId, exportId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const result = await createArtifactExportDownloadUrl(
      context,
      {
        projectId,
        exportId,
        expiresInSeconds: query.expiresInSeconds,
      },
      createObjectStorageAdapterFromEnv(env),
    );

    return result;
  },
});
