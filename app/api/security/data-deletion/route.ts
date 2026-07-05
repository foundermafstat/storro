import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { deleteOrganizationData } from "@/services/security-service";

const bodySchema = z.object({
  confirmOrgSlug: z.string().min(1),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const deletion = await deleteOrganizationData(context, body);

    return { deletion };
  },
});
