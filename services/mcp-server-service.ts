import { z } from "zod";
import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { recordAuditEvent } from "@/services/audit-service";
import { enqueueArtifactGeneration } from "@/services/artifact-generation-service";
import { saveArtifactRevision } from "@/services/artifact-editor-service";
import { AuthenticationError, NotFoundError, RateLimitError, ValidationServiceError } from "@/services/errors";
import { createProject, listProjects } from "@/services/project-service";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

type McpToolName =
  | "create_project"
  | "list_projects"
  | "ingest_chatgpt_context"
  | "ingest_codex_turn"
  | "ingest_research_note"
  | "ingest_build_note"
  | "generate_story"
  | "retrieve_artifact"
  | "save_revision";

const messageTimelineItemSchema = z.object({
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  role: z.enum(["system", "user", "assistant", "tool"]).optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
});

const toolSchemas = {
  create_project: z.object({ name: z.string().min(1), description: z.string().optional() }),
  list_projects: z.object({ search: z.string().optional() }),
  ingest_chatgpt_context: z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1),
    body: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    conversationId: z.string().optional(),
    messageIds: z.array(z.string().min(1)).optional(),
    occurredAt: z.string().datetime().optional(),
    messageTimeline: z.array(messageTimelineItemSchema).optional(),
  }),
  ingest_codex_turn: z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1).optional(),
    prompt: z.string().min(1),
    responseSummary: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    branchNames: z.array(z.string().min(1)).optional(),
    commitRange: z.string().optional(),
    filesTouched: z.array(z.string().min(1)).optional(),
    decisions: z.array(z.string().min(1)).optional(),
    fixes: z.array(z.string().min(1)).optional(),
  }),
  ingest_research_note: z.object({ projectId: z.string().uuid(), title: z.string().min(1), body: z.string().min(1) }),
  ingest_build_note: z.object({ projectId: z.string().uuid(), title: z.string().min(1), body: z.string().min(1) }),
  generate_story: z.object({ projectId: z.string().uuid(), storyRunId: z.string().uuid(), promptVersion: z.string().optional() }),
  retrieve_artifact: z.object({ projectId: z.string().uuid(), artifactId: z.string().uuid() }),
  save_revision: z.object({ projectId: z.string().uuid(), artifactId: z.string().uuid(), contentMarkdown: z.string().min(1) }),
} satisfies Record<McpToolName, z.ZodType>;

export const mcpTools = [
  tool("create_project", "Create a Storro project.", {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" }, description: { type: "string" } },
  }),
  tool("list_projects", "List projects visible to the authenticated user.", {
    type: "object",
    properties: { search: { type: "string" } },
  }),
  tool("ingest_chatgpt_context", "Create a Storro source from selected ChatGPT conversation context.", {
    type: "object",
    required: ["projectId", "title", "body"],
    properties: {
      projectId: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      sourceUrl: { type: "string" },
      conversationId: { type: "string" },
      messageIds: { type: "array", items: { type: "string" } },
      occurredAt: { type: "string" },
      messageTimeline: {
        type: "array",
        items: {
          type: "object",
          properties: {
            conversationId: { type: "string" },
            messageId: { type: "string" },
            role: { type: "string" },
            text: { type: "string" },
            summary: { type: "string" },
            occurredAt: { type: "string" },
          },
        },
      },
    },
  }),
  tool("ingest_codex_turn", "Create a Storro source from a user-selected Codex prompt and outcome.", {
    type: "object",
    required: ["projectId", "prompt", "responseSummary"],
    properties: {
      projectId: { type: "string" },
      title: { type: "string" },
      prompt: { type: "string" },
      responseSummary: { type: "string" },
      occurredAt: { type: "string" },
      branchNames: { type: "array", items: { type: "string" } },
      commitRange: { type: "string" },
      filesTouched: { type: "array", items: { type: "string" } },
      decisions: { type: "array", items: { type: "string" } },
      fixes: { type: "array", items: { type: "string" } },
    },
  }),
  tool("ingest_research_note", "Create a normal Storro source record from explicit research text.", {
    type: "object",
    required: ["projectId", "title", "body"],
    properties: { projectId: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
  }),
  tool("ingest_build_note", "Create a normal Storro source record from explicit build notes.", {
    type: "object",
    required: ["projectId", "title", "body"],
    properties: { projectId: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
  }),
  tool("generate_story", "Queue artifact generation from an approved story plan.", {
    type: "object",
    required: ["projectId", "storyRunId"],
    properties: { projectId: { type: "string" }, storyRunId: { type: "string" }, promptVersion: { type: "string" } },
  }),
  tool("retrieve_artifact", "Retrieve a Storro artifact by id.", {
    type: "object",
    required: ["projectId", "artifactId"],
    properties: { projectId: { type: "string" }, artifactId: { type: "string" } },
  }),
  tool("save_revision", "Save an editor revision for an artifact.", {
    type: "object",
    required: ["projectId", "artifactId", "contentMarkdown"],
    properties: { projectId: { type: "string" }, artifactId: { type: "string" }, contentMarkdown: { type: "string" } },
  }),
];

export async function executeMcpTool(
  context: ScopedContext | null | undefined,
  input: {
    name: string;
    arguments?: unknown;
  },
  db: DatabaseClient = prisma,
) {
  if (!context) {
    throw new AuthenticationError("MCP authentication is required.");
  }

  requireScopedContext(context);
  const name = input.name as McpToolName;
  const schema = toolSchemas[name];

  if (!schema) {
    throw new ValidationServiceError("Unknown MCP tool.", { name: input.name });
  }

  await assertMcpRateLimit(context, db);
  schema.parse(input.arguments ?? {});
  const result = await dispatchTool(context, name, input.arguments ?? {}, db);

  await recordAuditEvent(
    context,
    {
      action: `mcp.tool.${name}`,
      entityType: "mcpTool",
      metadata: { name },
    },
    db,
  );

  return result;
}

async function dispatchTool(context: ScopedContext, name: McpToolName, rawArgs: unknown, db: DatabaseClient) {
  switch (name) {
    case "create_project": {
      const args = toolSchemas.create_project.parse(rawArgs);
      return { project: await createProject(context, args, db) };
    }
    case "list_projects": {
      const args = toolSchemas.list_projects.parse(rawArgs);
      return { projects: await listProjects(context, { search: args.search }, db) };
    }
    case "ingest_chatgpt_context": {
      const args = toolSchemas.ingest_chatgpt_context.parse(rawArgs);
      return {
        source: await createSourceDocument(context, {
          projectId: args.projectId,
          title: args.title,
          body: args.body,
          sourceType: "CHATGPT_NOTE",
          tags: ["mcp", "chatgpt", "selected-context"],
          sourceCreatedAt: args.occurredAt ? new Date(args.occurredAt) : undefined,
          provenance: {
            kind: "chatgpt",
            externalUrl: args.sourceUrl,
            importedAt: new Date(),
          },
          metadata: {
            chatGptConnector: {
              selectedOnly: true,
              importedAt: new Date().toISOString(),
              conversationId: args.conversationId,
              messageIds: args.messageIds,
              occurredAt: args.occurredAt,
              messageTimeline: args.messageTimeline,
            },
          },
        }, db),
      };
    }
    case "ingest_codex_turn": {
      const args = toolSchemas.ingest_codex_turn.parse(rawArgs);
      const title = args.title ?? `Codex turn · ${args.prompt.slice(0, 60)}`;

      return {
        source: await createSourceDocument(context, {
          projectId: args.projectId,
          title,
          body: renderCodexTurnBody(args),
          sourceType: "CODEX_NOTE",
          tags: ["mcp", "codex", "selected-turn"],
          isPrivate: true,
          sourceCreatedAt: args.occurredAt ? new Date(args.occurredAt) : undefined,
          provenance: {
            kind: "codex",
            importedAt: new Date(),
          },
          metadata: {
            codexTurn: {
              prompt: args.prompt,
              responseSummary: args.responseSummary,
              occurredAt: args.occurredAt,
              branchNames: args.branchNames,
              commitRange: args.commitRange,
              filesTouched: args.filesTouched,
              decisions: args.decisions,
              fixes: args.fixes,
              selectedOnly: true,
              importedAt: new Date().toISOString(),
            },
          },
        }, db),
      };
    }
    case "ingest_research_note": {
      const args = toolSchemas.ingest_research_note.parse(rawArgs);
      return {
        source: await createSourceDocument(context, {
          projectId: args.projectId,
          title: args.title,
          body: args.body,
          sourceType: "MANUAL_NOTE",
          tags: ["mcp", "research"],
          provenance: { kind: "mcp" },
        }, db),
      };
    }
    case "ingest_build_note": {
      const args = toolSchemas.ingest_build_note.parse(rawArgs);
      return {
        source: await createSourceDocument(context, {
          projectId: args.projectId,
          title: args.title,
          body: args.body,
          sourceType: "MANUAL_NOTE",
          tags: ["mcp", "build"],
          provenance: { kind: "mcp" },
        }, db),
      };
    }
    case "generate_story": {
      const args = toolSchemas.generate_story.parse(rawArgs);
      return { job: await enqueueArtifactGeneration(context, args, db) };
    }
    case "retrieve_artifact": {
      const args = toolSchemas.retrieve_artifact.parse(rawArgs);
      await assertProjectPermission(context, args.projectId, "artifact.read", db);
      return { artifact: await getArtifact(context, args.projectId, args.artifactId, db) };
    }
    case "save_revision": {
      const args = toolSchemas.save_revision.parse(rawArgs);
      return { revision: await saveArtifactRevision(context, { ...args, saveMode: "manual" }, db) };
    }
  }
}

async function assertMcpRateLimit(context: ScopedContext, db: DatabaseClient) {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  const count = await db.auditLog.count({
    where: {
      orgId: context.orgId,
      userId: context.userId,
      action: { startsWith: "mcp.tool." },
      createdAt: { gte: oneMinuteAgo },
    },
  });

  if (count >= 120) {
    throw new RateLimitError("MCP rate limit exceeded.");
  }
}

async function getArtifact(context: ScopedContext, projectId: string, artifactId: string, db: DatabaseClient) {
  const artifact = await db.storyArtifact.findFirst({
    where: { id: artifactId, orgId: context.orgId, projectId, archivedAt: null },
  });

  if (!artifact) {
    throw new NotFoundError("Artifact not found.");
  }

  return artifact;
}

function tool(name: McpToolName, description: string, inputSchema: Record<string, unknown>) {
  return { name, description, inputSchema };
}

function renderCodexTurnBody(args: z.infer<typeof toolSchemas.ingest_codex_turn>) {
  return [
    "# Codex prompt",
    args.prompt,
    "",
    "# Response summary",
    args.responseSummary,
    args.branchNames?.length ? `\n# Branches\n${args.branchNames.map((branch) => `- ${branch}`).join("\n")}` : "",
    args.commitRange ? `\n# Commit range\n${args.commitRange}` : "",
    args.filesTouched?.length ? `\n# Files touched\n${args.filesTouched.map((file) => `- ${file}`).join("\n")}` : "",
    args.decisions?.length ? `\n# Decisions\n${args.decisions.map((decision) => `- ${decision}`).join("\n")}` : "",
    args.fixes?.length ? `\n# Fixes\n${args.fixes.map((fix) => `- ${fix}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
