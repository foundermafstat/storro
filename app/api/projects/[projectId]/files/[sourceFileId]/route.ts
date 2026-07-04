import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { deleteSourceFile, createObjectStorageAdapterFromEnv } from "@/services/file-upload-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
});

export const DELETE = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, sourceFileId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const storage = createObjectStorageAdapterFromEnv(createServerEnv());
    const sourceFile = await deleteSourceFile(context, { sourceFileId, projectId }, storage);

    return { sourceFile };
  },
});
