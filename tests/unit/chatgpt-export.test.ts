import { describe, expect, it } from "vitest";
import { parseChatGptConversationsExport } from "@/services/chatgpt-export-service";

const validExport = JSON.stringify([
  {
    id: "conv-1",
    title: "Build parser",
    create_time: 1_700_000_000,
    update_time: 1_700_000_120,
    mapping: {
      root: {
        id: "root",
      },
      msg_user: {
        message: {
          id: "msg-user",
          author: { role: "user" },
          create_time: 1_700_000_010,
          content: {
            parts: ["Please build the parser."],
          },
        },
      },
      msg_assistant: {
        message: {
          id: "msg-assistant",
          author: { role: "assistant" },
          create_time: 1_700_000_020,
          content: {
            parts: ["Parser implemented."],
          },
        },
      },
    },
  },
]);

describe("ChatGPT export parser", () => {
  it("parses official conversations.json into selectable conversations", () => {
    const result = parseChatGptConversationsExport(validExport);

    expect(result.warnings).toEqual([]);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      id: "conv-1",
      title: "Build parser",
      messages: [
        {
          id: "msg-user",
          sourceId: "msg-user",
          role: "user",
          text: "Please build the parser.",
        },
        {
          id: "msg-assistant",
          sourceId: "msg-assistant",
          role: "assistant",
          text: "Parser implemented.",
        },
      ],
    });
  });

  it("returns warnings for malformed exports without crashing", () => {
    const result = parseChatGptConversationsExport("{not-json");

    expect(result.conversations).toEqual([]);
    expect(result.warnings[0]).toContain("Malformed JSON export");
  });

  it("returns warnings for conversations without messages", () => {
    const result = parseChatGptConversationsExport(JSON.stringify([{ id: "empty", title: "Empty" }]));

    expect(result.conversations).toEqual([]);
    expect(result.warnings).toEqual([
      "Empty: Conversation has neither mapping nor messages array.",
      "Empty: No importable messages found.",
    ]);
  });
});
