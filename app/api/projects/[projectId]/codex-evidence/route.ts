import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  getExtractionFactCodexProvenance,
  markGitHubContextAsCodexAssisted,
} from "@/services/codex-evidence-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  sourceDocumentIds: z.array(z.string().uuid()).min(1),
  summary: z.string().min(1),
  prompts: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional(),
  fixes: z.array(z.string()).optional(),
  commitRange: z.string().optional(),
  pullRequestNumbers: z.array(z.number().int().positive()).optional(),
  branchNames: z.array(z.string()).optional(),
});

const querySchema = z.object({
  factId: z.string().uuid().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    if (!query.factId) {
      return { provenance: [] };
    }

    const provenance = await getExtractionFactCodexProvenance(context, {
      projectId,
      factId: query.factId,
    });

    return { provenance };
  },
});

export const POST = createApiRoute({
  bodySchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const result = await markGitHubContextAsCodexAssisted(context, {
      ...body,
      projectId,
    });

    return result;
  },
});
