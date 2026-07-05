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

  it("stores selected ChatGPT message timeline metadata", async () => {
    await executeMcpTool(context, {
      name: "ingest_chatgpt_context",
      arguments: {
        projectId,
        title: "Selected ChatGPT context",
        body: "User asked for timeline-first story flow.",
        conversationId: "chatgpt-conv-1",
        messageIds: ["msg-1"],
        occurredAt: "2026-07-04T08:00:00.000Z",
        messageTimeline: [
          {
            messageId: "msg-1",
            role: "user",
            summary: "Asked for fewer steps and selected chats.",
            occurredAt: "2026-07-04T08:00:00.000Z",
          },
        ],
      },
    });
    const source = await prisma.sourceDocument.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        title: "Selected ChatGPT context",
      },
    });

    expect(source.sourceType).toBe("CHATGPT_NOTE");
    expect(source.sourceCreatedAt?.toISOString()).toBe("2026-07-04T08:00:00.000Z");
    expect(source.metadata).toMatchObject({
      chatGptConnector: {
        selectedOnly: true,
        conversationId: "chatgpt-conv-1",
        messageIds: ["msg-1"],
      },
    });
  });

  it("validates and stores selected Codex turns", async () => {
    await expect(executeMcpTool(context, {
      name: "ingest_codex_turn",
      arguments: {
        projectId,
        prompt: "",
        responseSummary: "empty prompt must fail",
      },
    })).rejects.toThrow();

    await executeMcpTool(context, {
      name: "ingest_codex_turn",
      arguments: {
        projectId,
        prompt: "Implement timeline-first flow.",
        responseSummary: "Added timeline, workflow endpoints, and UI.",
        occurredAt: "2026-07-04T10:00:00.000Z",
        branchNames: ["main"],
        commitRange: "abc123..def456",
        filesTouched: ["components/project-workflow-panel.tsx"],
        decisions: ["Keep review gate."],
        fixes: ["Hide manual queue controls in Advanced."],
      },
    });
    const source = await prisma.sourceDocument.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        sourceType: "CODEX_NOTE",
        title: {
          contains: "Codex turn",
        },
      },
    });

    expect(source.tags).toEqual(expect.arrayContaining(["mcp", "codex", "selected-turn"]));
    expect(source.sourceCreatedAt?.toISOString()).toBe("2026-07-04T10:00:00.000Z");
    expect(source.metadata).toMatchObject({
      codexTurn: {
        prompt: "Implement timeline-first flow.",
        responseSummary: "Added timeline, workflow endpoints, and UI.",
        selectedOnly: true,
      },
    });
  });

  it("covers every MCP tool contract schema", () => {
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "create_project",
      "list_projects",
      "ingest_chatgpt_context",
      "ingest_codex_turn",
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
