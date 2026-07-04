import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createProject, listProjects } from "@/services/project-service";

const projectSettingsSchema = z.object({
  visibility: z.enum(["PRIVATE", "ORGANIZATION", "PUBLIC"]).optional(),
  sourcePrivacyDefault: z.boolean().optional(),
  aiReviewRequired: z.boolean().optional(),
  defaultArtifactFormat: z.string().min(1).optional(),
  billingCode: z.string().min(1).optional(),
});

const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullish(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  settings: projectSettingsSchema.optional(),
});

const listProjectsQuerySchema = z
  .object({
    search: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  })
  .transform((query) => ({
    search: query.search,
    status: query.status,
    includeArchived: query.includeArchived === "true",
    tags: normalizeQueryTags(query.tags),
  }));

export const GET = createApiRoute({
  querySchema: listProjectsQuerySchema,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const projects = await listProjects(context, query);

    return { projects };
  },
});

export const POST = createApiRoute({
  bodySchema: createProjectSchema,
  successStatus: 201,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const project = await createProject(context, body);

    return { project };
  },
});

function normalizeQueryTags(value: string | string[] | undefined) {
  if (!value) {
    return undefined;
  }

  const tags = Array.isArray(value) ? value : value.split(",");
  return tags.map((tag) => tag.trim()).filter(Boolean);
}
