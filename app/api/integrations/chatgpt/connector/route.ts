import { z } from "zod";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { mcpTools } from "@/services/mcp-server-service";

const querySchema = z.object({
  projectId: z.string().uuid(),
});

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, request }) => {
    const token = process.env.CHATGPT_CONNECTOR_TOKEN;

    if (!token) {
      throw new ValidationServiceError("ChatGPT connector token is not configured.");
    }

    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    await assertProjectPermission(context, query.projectId, "project.read");

    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    const origin = configuredOrigin || requestOrigin;
    const connectorUrl = new URL("/api/mcp", origin);

    connectorUrl.searchParams.set("projectId", query.projectId);
    connectorUrl.searchParams.set("token", token);

    return {
      connectorUrl: connectorUrl.toString(),
      publicHttps: connectorUrl.protocol === "https:",
      chatGptUrl: "https://chatgpt.com",
      tools: mcpTools.filter((tool) => tool.name === "ingest_chatgpt_context" || tool.name === "retrieve_artifact" || tool.name === "save_revision"),
    };
  },
});
