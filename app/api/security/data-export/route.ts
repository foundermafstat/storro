import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { exportOrganizationData } from "@/services/security-service";

export const GET = createApiRoute({
  handler: async ({ request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const exportData = await exportOrganizationData(context);

    return { exportData };
  },
});
