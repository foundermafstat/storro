import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { executeMcpTool, mcpTools } from "@/services/mcp-server-service";

const bodySchema = z.object({
  method: z.enum(["tools/list", "tools/call"]),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.unknown().optional(),
    })
    .optional(),
});

export const POST = createApiRoute({
  bodySchema,
  handler: async ({ body, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));

    if (body.method === "tools/list") {
      return { tools: mcpTools };
    }

    const result = await executeMcpTool(context, {
      name: body.params?.name ?? "",
      arguments: body.params?.arguments,
    });

    return { content: [{ type: "json", json: result }] };
  },
});
