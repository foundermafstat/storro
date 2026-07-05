import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/db/client";
import { getCurrentAuthContext } from "@/server/auth-context";
import { AuthenticationError, NotFoundError, ValidationServiceError } from "@/services/errors";
import { executeMcpTool, mcpTools } from "@/services/mcp-server-service";
import type { ScopedContext } from "@/services/scoped-context";

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const toolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.unknown().optional(),
});

const projectScopedToolNames = new Set([
  "ingest_chatgpt_context",
  "ingest_research_note",
  "ingest_build_note",
  "generate_story",
  "retrieve_artifact",
  "save_revision",
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  return jsonResponse({
    name: "Storro MCP",
    endpoint: "/api/mcp",
    publicHttps: url.protocol === "https:",
    tools: mcpTools,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);

  if (Array.isArray(rawBody)) {
    const responses = await Promise.all(rawBody.map((item) => handleJsonRpcMessage(request, item)));

    return jsonResponse(responses.filter(Boolean));
  }

  const response = await handleJsonRpcMessage(request, rawBody);

  if (!response) {
    return emptyResponse();
  }

  return jsonResponse(response);
}

export async function OPTIONS() {
  return emptyResponse();
}

async function handleJsonRpcMessage(request: NextRequest, rawBody: unknown) {
  const parsed = jsonRpcRequestSchema.safeParse(rawBody);
  const id = parsed.success ? parsed.data.id : null;

  if (!parsed.success) {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
  }

  if (parsed.data.method === "notifications/initialized") {
    return null;
  }

  if (parsed.data.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "storro",
        version: "0.1.0",
      },
    });
  }

  if (parsed.data.method === "ping") {
    return jsonRpcResult(id, {});
  }

  try {
    const resolved = await resolveMcpContext(request);

    if (parsed.data.method === "tools/list") {
      return jsonRpcResult(id, {
        tools: resolved.projectId ? mcpTools.filter((tool) => projectScopedToolNames.has(tool.name)) : mcpTools,
      });
    }

    if (parsed.data.method !== "tools/call") {
      return jsonRpcError(id, -32601, "Method not found.");
    }

    const params = toolCallParamsSchema.parse(parsed.data.params ?? {});

    assertProjectScopedTool(params.name, params.arguments, resolved.projectId);

    const result = await executeMcpTool(resolved.context, {
      name: params.name,
      arguments: params.arguments,
    });

    return jsonRpcResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      structuredContent: result,
    });
  } catch (error) {
    return jsonRpcError(id, -32000, error instanceof Error ? error.message : "MCP tool failed.");
  }
}

async function resolveMcpContext(request: NextRequest): Promise<{ context: ScopedContext; projectId?: string }> {
  try {
    return {
      context: await getCurrentAuthContext(request.headers.get("x-storro-org-id")),
    };
  } catch {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const token = url.searchParams.get("token") ?? readBearerToken(request.headers.get("authorization"));

    if (!projectId || !token || token !== process.env.CHATGPT_CONNECTOR_TOKEN) {
      throw new AuthenticationError("Valid MCP connector token is required.");
    }

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        archivedAt: null,
      },
      select: {
        id: true,
        orgId: true,
        ownerId: true,
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found.");
    }

    return {
      context: {
        orgId: project.orgId,
        userId: project.ownerId,
      },
      projectId: project.id,
    };
  }
}

function assertProjectScopedTool(name: string, args: unknown, projectId?: string) {
  if (!projectId) {
    return;
  }

  if (!projectScopedToolNames.has(name)) {
    throw new ValidationServiceError("Tool is not available for project-scoped connectors.");
  }

  if (!args || typeof args !== "object" || Array.isArray(args) || (args as { projectId?: unknown }).projectId !== projectId) {
    throw new ValidationServiceError("Tool arguments must include the connector projectId.");
  }
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function jsonResponse(body: unknown) {
  return NextResponse.json(body, {
    headers: corsHeaders(),
  });
}

function emptyResponse() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": [
      "Authorization",
      "Content-Type",
      "MCP-Protocol-Version",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ].join(", "),
    "Access-Control-Max-Age": "86400",
  };
}

function readBearerToken(value: string | null) {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }

  return value.slice("Bearer ".length);
}
