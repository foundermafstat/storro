import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import { importSelectedChatGptConversations } from "@/services/chatgpt-export-service";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

const exportJson = JSON.stringify([
  {
    id: "conv-selected",
    title: "Selected conversation",
    create_time: 1_700_000_000,
    update_time: 1_700_000_120,
    mapping: {
      user: {
        message: {
          id: "selected-user",
          author: { role: "user" },
          create_time: 1_700_000_010,
          content: { parts: ["User requirement"] },
        },
      },
      assistant: {
        message: {
          id: "selected-assistant",
          author: { role: "assistant" },
          create_time: 1_700_000_020,
          content: { parts: ["Assistant implementation detail"] },
        },
      },
    },
  },
  {
    id: "conv-skipped",
    title: "Skipped conversation",
    messages: [{ id: "skipped-user", role: "user", text: "Do not import" }],
  },
]);

describe("ChatGPT selected import", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `chatgpt-user-${suffix}`,
        email: `chatgpt-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `ChatGPT Org ${suffix}`,
        slug: `chatgpt-org-${suffix}`,
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
      name: `ChatGPT Project ${suffix}`,
    });

    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: orgId,
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  it("imports selected conversations and messages only with role/order/timestamp metadata", async () => {
    const result = await importSelectedChatGptConversations(context, {
      projectId,
      rawJson: exportJson,
      selectedConversationIds: ["conv-selected"],
      selectedMessageIds: ["selected-user", "selected-assistant"],
      tags: ["chatgpt-export"],
    });

    expect(result.sources).toHaveLength(1);
    const source = result.sources[0];

    expect(source.sourceType).toBe("CHATGPT_EXPORT");
    expect(source.title).toBe("Selected conversation");
    expect(source.rawText).toContain("user\nUser requirement");
    expect(source.rawText).toContain("assistant\nAssistant implementation detail");
    expect(source.rawText).not.toContain("Do not import");
    expect(source.tags).toEqual(["chatgpt", "chatgpt-export"]);
    expect(source.isPrivate).toBe(true);
    expect(source.metadata).toMatchObject({
      chatgpt: {
        conversationId: "conv-selected",
        messages: [
          {
            id: "selected-user",
            role: "user",
            order: 0,
            createdAt: "2023-11-14T22:13:30.000Z",
          },
          {
            id: "selected-assistant",
            role: "assistant",
            order: 1,
            createdAt: "2023-11-14T22:13:40.000Z",
          },
        ],
      },
      provenance: {
        kind: "chatgpt",
        externalId: "conv-selected",
      },
    });
  });
});
