import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { getMetricsDashboard } from "@/services/observability-service";

export const GET = createApiRoute({
  handler: async ({ request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    const metrics = await getMetricsDashboard(context);

    return { metrics };
  },
});
