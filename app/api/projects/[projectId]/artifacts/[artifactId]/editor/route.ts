import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  getArtifactEditorView,
  renderMarkdownPreviewHtml,
  saveArtifactRevision,
} from "@/services/artifact-editor-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

const bodySchema = z.object({
  contentMarkdown: z.string().min(1),
  saveMode: z.enum(["autosave", "manual"]),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId, artifactId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const view = await getArtifactEditorView(context, {
      projectId,
      artifactId,
    });

    return view;
  },
});

export const PATCH = createApiRoute({
  bodySchema,
  handler: async ({ body, params, request }) => {
    const { projectId, artifactId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await saveArtifactRevision(context, {
      projectId,
      artifactId,
      contentMarkdown: body.contentMarkdown,
      saveMode: body.saveMode,
    });

    return {
      ...result,
      previewHtml: renderMarkdownPreviewHtml(result.artifact.contentMarkdown),
    };
  },
});
