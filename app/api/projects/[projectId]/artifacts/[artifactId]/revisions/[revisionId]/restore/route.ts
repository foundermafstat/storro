import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  renderMarkdownPreviewHtml,
  restoreArtifactRevision,
} from "@/services/artifact-editor-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  artifactId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

export const POST = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, artifactId, revisionId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await restoreArtifactRevision(context, {
      projectId,
      artifactId,
      revisionId,
    });

    return {
      ...result,
      previewHtml: renderMarkdownPreviewHtml(result.artifact.contentMarkdown),
    };
  },
});
