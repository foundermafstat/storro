import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { updateExtractionFactReview } from "@/services/extraction-review-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  factId: z.string().uuid(),
});

const reviewSchema = z.object({
  text: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  isPrivate: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoningNote: z.string().nullable().optional(),
});

export const PATCH = createApiRoute({
  bodySchema: reviewSchema,
  handler: async ({ body, params, request }) => {
    const { projectId, factId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const fact = await updateExtractionFactReview(context, { factId, projectId }, body);

    return { fact };
  },
});
