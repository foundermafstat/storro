import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { createStructuredManualNote } from "@/services/manual-note-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const manualNoteSchema = z
  .object({
    title: z.string().min(2).max(200),
    kind: z.enum([
      "research_note",
      "build_note",
      "daily_journal",
      "failed_attempt",
      "lesson",
      "public_comment",
      "private_comment",
    ]),
    whatTried: z.string().optional(),
    whatWorked: z.string().optional(),
    whatFailed: z.string().optional(),
    filesTouched: z.array(z.string().min(1)).max(100).optional(),
    nextStep: z.string().optional(),
    publicSummary: z.string().optional(),
    privateNotes: z.string().optional(),
    isPrivate: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(40)).max(30).optional(),
    sourceCreatedAt: z.string().datetime().optional(),
  })
  .transform((input) => ({
    ...input,
    sourceCreatedAt: input.sourceCreatedAt ? new Date(input.sourceCreatedAt) : undefined,
  }));

export const POST = createApiRoute({
  bodySchema: manualNoteSchema,
  successStatus: 201,
  handler: async ({ body, params, request }) => {
    const { projectId } = paramsSchema.parse(params);
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const source = await createStructuredManualNote(context, {
      ...body,
      projectId,
    });

    return { source };
  },
});
