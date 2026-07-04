import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  executeMcpTool,
  mcpTools,
} from "@/services/mcp-server-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

describe("mcp server service", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `mcp-user-${suffix}`,
        email: `mcp-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `MCP Org ${suffix}`,
        slug: `mcp-org-${suffix}`,
      },
    });

    userId = user.id;
    orgId = org.id;
    context = { orgId, userId };

    await prisma.membership.create({
      data: {
        orgId,
        userId,
        role: "OWNER",
      },
    });

    const project = await createProject(context, {
      name: `MCP Project ${suffix}`,
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("validates tool schemas and creates normal source records", async () => {
    await expect(executeMcpTool(context, { name: "ingest_research_note", arguments: { projectId, title: "Missing body" } })).rejects.toThrow();

    const result = await executeMcpTool(context, {
      name: "ingest_research_note",
      arguments: {
        projectId,
        title: "Research note",
        body: "Explicit MCP research note.",
      },
    });
    const source = await prisma.sourceDocument.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        title: "Research note",
      },
    });

    expect(result).toMatchObject({ source: { id: source.id } });
    expect(source.tags).toEqual(expect.arrayContaining(["mcp", "research"]));
  });

  it("lists projects and rejects unauthenticated tool calls", async () => {
    const result = await executeMcpTool(context, { name: "list_projects", arguments: {} });

    expect((result as { projects: Array<{ id: string }> }).projects.map((project) => project.id)).toContain(projectId);
    await expect(executeMcpTool(null, { name: "list_projects", arguments: {} })).rejects.toThrow("MCP authentication is required.");
  });

  it("covers every MCP tool contract schema", () => {
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "create_project",
      "list_projects",
      "ingest_research_note",
      "ingest_build_note",
      "generate_story",
      "retrieve_artifact",
      "save_revision",
    ]);

    for (const tool of mcpTools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});
