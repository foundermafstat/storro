import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getAdminConsole } from "@/services/admin-console-service";

const querySchema = z
  .object({
    userSearch: z.string().optional(),
    organizationSearch: z.string().optional(),
    includeRawSourceContent: z.enum(["true", "false"]).optional(),
    privilegedReason: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .transform((query) => ({
    ...query,
    includeRawSourceContent: query.includeRawSourceContent === "true",
  }));

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const consoleState = await getAdminConsole(context, query);

    return { console: consoleState };
  },
});
