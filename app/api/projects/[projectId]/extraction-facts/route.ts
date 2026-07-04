import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import {
  addMissingExtractionFact,
  listExtractionFacts,
} from "@/services/extraction-review-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const querySchema = z
  .object({
    category: z.string().optional(),
    sourceId: z.string().optional(),
    isPrivate: z.enum(["true", "false"]).optional(),
    minConfidence: z.string().optional(),
    reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  })
  .transform((query) => ({
    category: query.category,
    sourceId: query.sourceId,
    isPrivate: query.isPrivate ? query.isPrivate === "true" : undefined,
    minConfidence: query.minConfidence ? Number(query.minConfidence) : undefined,
    reviewStatus: query.reviewStatus,
  }));

const createFactSchema = z.object({
  extractionRunId: z.string().uuid(),
  category: z.string().min(1),
  text: z.string().min(1),
  sourceIds: z.array(z.string().uuid()).min(1),
  filePaths: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  isPrivate: z.boolean().optional(),
  reasoningNote: z.string().optional(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ params, query, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const facts = await listExtractionFacts(context, {
      ...query,
      projectId,
    });

    return { facts };
  },
});

export const POST = createApiRoute({
  bodySchema: createFactSchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const fact = await addMissingExtractionFact(context, {
      ...body,
      projectId,
    });

    return { fact };
  },
});
