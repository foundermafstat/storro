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
  | "ingest_research_note"
  | "ingest_build_note"
  | "generate_story"
  | "retrieve_artifact"
  | "save_revision";

const toolSchemas = {
  create_project: z.object({ name: z.string().min(1), description: z.string().optional() }),
  list_projects: z.object({ search: z.string().optional() }),
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
