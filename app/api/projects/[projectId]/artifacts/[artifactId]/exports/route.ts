import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createServerEnv } from "@/server/env";
import { createArtifactExport } from "@/services/artifact-export-service";
import { createObjectStorageAdapterFromEnv } from "@/services/file-upload-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

const bodySchema = z.object({
  exportFormat: z.enum(["MARKDOWN", "PLAIN_TEXT", "PDF_HTML", "RELEASE_NOTES", "CLIPBOARD"]),
  revisionId: z.string().uuid().optional(),
  overrideGrounding: z.boolean().optional(),
  overrideReason: z.string().optional(),
  expiresInSeconds: z.number().int().optional(),
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId, artifactId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const env = createServerEnv();
    const result = await createArtifactExport(
      context,
      {
        ...body,
        projectId,
        artifactId,
      },
      createObjectStorageAdapterFromEnv(env),
    );

    return result;
  },
});
