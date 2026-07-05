import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/db/client";
import { createApiRoute } from "@/server/api/route-handler";
import { getCurrentAuthContext } from "@/server/auth-context";
import { assertProjectPermission } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { ValidationServiceError } from "@/services/errors";
import { mcpTools } from "@/services/mcp-server-service";
import type { ScopedContext } from "@/services/scoped-context";

const querySchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  action: z.literal("connect"),
});

const codexToolNames = new Set([
  "ingest_research_note",
  "ingest_build_note",
  "generate_story",
  "retrieve_artifact",
  "save_revision",
]);

export const GET = createApiRoute({
  querySchema,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    await assertProjectPermission(context, query.projectId, "project.read");

    return buildCodexConnectorResponse(context, query.projectId, request);
  },
});

export const POST = createApiRoute({
  bodySchema,
  querySchema,
  successStatus: 201,
  handler: async ({ query, request }) => {
    const context = await getCurrentAuthContext(request.headers.get("x-storro-org-id"));
    await assertProjectPermission(context, query.projectId, "integration.manage");

    const response = await buildCodexConnectorResponse(context, query.projectId, request);
    const externalId = `codex:mcp:${query.projectId}`;
    const now = new Date();
    const metadata = {
      connector: "mcp",
      endpoint: "/api/mcp",
      publicHttps: response.publicHttps,
      connectedAt: now.toISOString(),
      disclaimer: "Codex sends only explicit tool calls to Storro. Storro does not access private Codex sessions.",
    } satisfies Prisma.InputJsonObject;

    const existing = await prisma.sourceConnection.findFirst({
      where: {
        orgId: context.orgId,
        projectId: query.projectId,
        provider: "CODEX",
        externalId,
      },
    });

    const connection = existing
      ? await prisma.sourceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            status: "CONNECTED",
            displayName: "Codex MCP",
            metadata,
            lastSyncedAt: now,
          },
        })
      : await prisma.sourceConnection.create({
          data: {
            orgId: context.orgId,
            projectId: query.projectId,
            provider: "CODEX",
            status: "CONNECTED",
            externalId,
            displayName: "Codex MCP",
            metadata,
            lastSyncedAt: now,
          },
        });

    await recordAuditEvent(context, {
      action: "codex.connect",
      entityType: "SourceConnection",
      entityId: connection.id,
      projectId: query.projectId,
      metadata,
    });

    return {
      ...response,
      connected: true,
      connectedAt: now.toISOString(),
    };
  },
});

async function buildCodexConnectorResponse(context: ScopedContext, projectId: string, request: Request) {
  const token = process.env.CHATGPT_CONNECTOR_TOKEN;

  if (!token) {
    throw new ValidationServiceError("MCP connector token is not configured.");
  }

  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const origin = configuredOrigin || requestOrigin;
  const connectorUrl = new URL("/api/mcp", origin);
  const connection = await prisma.sourceConnection.findFirst({
    where: {
      orgId: context.orgId,
      projectId,
      provider: "CODEX",
      externalId: `codex:mcp:${projectId}`,
      status: "CONNECTED",
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  connectorUrl.searchParams.set("projectId", projectId);
  connectorUrl.searchParams.set("token", token);

  return {
    connectorUrl: connectorUrl.toString(),
    publicHttps: connectorUrl.protocol === "https:",
    connected: !!connection,
    connectedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    tools: mcpTools.filter((tool) => codexToolNames.has(tool.name)),
  };
}
