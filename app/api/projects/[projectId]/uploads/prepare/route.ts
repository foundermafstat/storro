import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import {
  createObjectStorageAdapterFromEnv,
  prepareSourceFileUpload,
} from "@/services/file-upload-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const prepareUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  title: z.string().min(2).max(200).optional(),
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  isPrivate: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresInSeconds: z.number().int().min(60).max(3600).optional(),
});

export const POST = createApiRoute({
  bodySchema: prepareUploadSchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const storage = createObjectStorageAdapterFromEnv(createServerEnv());
    const upload = await prepareSourceFileUpload(context, {
      ...body,
      projectId,
    }, storage);

    return upload;
  },
});
