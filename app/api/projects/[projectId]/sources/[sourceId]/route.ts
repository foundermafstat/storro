import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { NotFoundError } from "@/services/errors";
import {
  getSourceDocumentById,
  softDeleteSourceDocument,
  updateSourceDocument,
} from "@/services/source-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sourceId: z.string().uuid(),
});

const updateSourceSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    body: z.string().nullable().optional(),
    rawObjectKey: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(40)).max(30).optional(),
    isPrivate: z.boolean().optional(),
    sourceCreatedAt: z.string().datetime().nullable().optional(),
  })
  .transform((input) => ({
    ...input,
    sourceCreatedAt:
      input.sourceCreatedAt === undefined
        ? undefined
        : input.sourceCreatedAt === null
          ? null
          : new Date(input.sourceCreatedAt),
  }));

export const GET = createApiRoute({
  handler: async ({ params, request }) => {
    const { sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const source = await getSourceDocumentById(context, sourceId);

    if (!source) {
      throw new NotFoundError("Source document not found.");
    }

    return { source };
  },
});

export const PATCH = createApiRoute({
  bodySchema: updateSourceSchema,
  handler: async ({ body, params, request }) => {
    const { sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const source = await updateSourceDocument(context, sourceId, body);

    return { source };
  },
});

export const DELETE = createApiRoute({
  handler: async ({ params, request }) => {
    const { sourceId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const source = await softDeleteSourceDocument(context, sourceId);

    return { source };
  },
});
