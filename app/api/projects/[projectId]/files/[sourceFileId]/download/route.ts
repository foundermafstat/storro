import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import {
  createObjectStorageAdapterFromEnv,
  createSignedSourceFileDownloadUrl,
} from "@/services/file-upload-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
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
    const { projectId, sourceFileId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const storage = createObjectStorageAdapterFromEnv(createServerEnv());
    const result = await createSignedSourceFileDownloadUrl(
      context,
      { sourceFileId, projectId },
      storage,
      query.expiresInSeconds,
    );

    return result;
  },
});
