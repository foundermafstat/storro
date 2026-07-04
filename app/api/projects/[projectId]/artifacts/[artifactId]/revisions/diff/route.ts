import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { diffArtifactRevisions } from "@/services/artifact-editor-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

const querySchema = z.object({
  baseRevisionId: z.string().uuid(),
  compareRevisionId: z.string().uuid(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId, artifactId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const diff = await diffArtifactRevisions(context, {
      projectId,
      artifactId,
      baseRevisionId: query.baseRevisionId,
      compareRevisionId: query.compareRevisionId,
    });

    return { diff };
  },
});
