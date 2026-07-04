import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  getProjectById,
  getProjectDashboardSummary,
  updateProject,
} from "@/services/project-service";
import { NotFoundError } from "@/services/errors";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const updateProjectSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  settings: z
    .object({
      visibility: z.enum(["PRIVATE", "ORGANIZATION", "PUBLIC"]).optional(),
      sourcePrivacyDefault: z.boolean().optional(),
      aiReviewRequired: z.boolean().optional(),
      defaultArtifactFormat: z.string().min(1).optional(),
      billingCode: z.string().min(1).optional(),
    })
    .optional(),
});

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const project = await getProjectById(context, projectId);

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    const summary = await getProjectDashboardSummary(context, projectId);

    return { project, summary };
  },
});

export const PATCH = createApiRoute({
  bodySchema: updateProjectSchema,
  handler: async ({ body, params, request }) => {
    const { projectId } = projectParamsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const project = await updateProject(context, projectId, body);

    return { project };
  },
});
