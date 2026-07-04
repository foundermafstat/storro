import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import { assertProjectPermission } from "@/services/authorization-service";
import { ValidationServiceError } from "@/services/errors";
import { createSourceDocument } from "@/services/source-service";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type ChatGptMessageRole = "system" | "user" | "assistant" | "tool" | "unknown";

export type ParsedChatGptMessage = {
  id: string;
  sourceId: string;
  role: ChatGptMessageRole;
  text: string;
  createdAt?: Date;
  order: number;
};

export type ParsedChatGptConversation = {
  id: string;
  sourceId: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
  messages: ParsedChatGptMessage[];
  warnings: string[];
};

export type ChatGptExportParseResult = {
  conversations: ParsedChatGptConversation[];
  warnings: string[];
};

export type ImportChatGptSelectionInput = {
  projectId: string;
  rawJson: string;
  selectedConversationIds: string[];
  selectedMessageIds?: string[];
  isPrivate?: boolean;
  tags?: string[];
};

export function parseChatGptConversationsExport(rawJson: string): ChatGptExportParseResult {
  let payload: unknown;

  try {
    payload = JSON.parse(rawJson) as unknown;
  } catch (error) {
    return {
      conversations: [],
      warnings: [`Malformed JSON export: ${error instanceof Error ? error.message : "unknown parse error"}`],
    };
  }

  if (!Array.isArray(payload)) {
    return {
      conversations: [],
      warnings: ["ChatGPT conversations.json must contain an array of conversations."],
    };
  }

  const warnings: string[] = [];
  const conversations = payload.flatMap((item, index) => {
    const parsed = parseConversation(item, index);
    warnings.push(...parsed.warnings.map((warning) => `${parsed.title}: ${warning}`));

    return parsed.messages.length > 0 ? [parsed] : [];
  });

  return {
    conversations,
    warnings,
  };
}

export async function importSelectedChatGptConversations(
  context: ScopedContext,
  input: ImportChatGptSelectionInput,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  await assertProjectPermission(context, input.projectId, "source.write", db);

  if (input.selectedConversationIds.length === 0) {
    throw new ValidationServiceError("Select at least one ChatGPT conversation.");
  }

  const parsed = parseChatGptConversationsExport(input.rawJson);
  const selectedConversationIds = new Set(input.selectedConversationIds);
  const selectedMessageIds = input.selectedMessageIds ? new Set(input.selectedMessageIds) : undefined;
  const selectedConversations = parsed.conversations.filter((conversation) =>
    selectedConversationIds.has(conversation.id),
  );

  const sources = [];

  for (const conversation of selectedConversations) {
    const messages = selectedMessageIds
      ? conversation.messages.filter((message) => selectedMessageIds.has(message.id))
      : conversation.messages;

    if (messages.length === 0) {
      parsed.warnings.push(`${conversation.title}: selected conversation contains no selected messages.`);
      continue;
    }

    sources.push(
      await createSourceDocument(
        context,
        {
          projectId: input.projectId,
          title: conversation.title,
          body: formatConversationTranscript(messages),
          sourceType: "CHATGPT_EXPORT",
          tags: ["chatgpt", ...(input.tags ?? [])],
          isPrivate: input.isPrivate ?? true,
          sourceCreatedAt: conversation.createdAt,
          metadata: {
            chatgpt: {
              conversationId: conversation.id,
              sourceId: conversation.sourceId,
              title: conversation.title,
              updatedAt: conversation.updatedAt?.toISOString(),
              selectedMessageCount: messages.length,
              messages: messages.map((message) => ({
                id: message.id,
                sourceId: message.sourceId,
                role: message.role,
                order: message.order,
                createdAt: message.createdAt?.toISOString(),
              })),
            },
          },
          provenance: {
            kind: "chatgpt",
            externalId: conversation.sourceId,
            actor: "official-export",
            importedAt: new Date(),
          },
        },
        db,
      ),
    );
  }

  return {
    sources,
    warnings: parsed.warnings,
  };
}

function parseConversation(value: unknown, index: number): ParsedChatGptConversation {
  const record = isRecord(value) ? value : {};
  const sourceId = readString(record.id) ?? readString(record.conversation_id) ?? `conversation-${index}`;
  const title = readString(record.title) ?? `Untitled conversation ${index + 1}`;
  const warnings: string[] = [];
  const messages = parseConversationMessages(record, warnings);

  if (messages.length === 0) {
    warnings.push("No importable messages found.");
  }

  return {
    id: sourceId,
    sourceId,
    title,
    createdAt: readDate(record.create_time ?? record.created_at),
    updatedAt: readDate(record.update_time ?? record.updated_at),
    messages,
    warnings,
  };
}

function parseConversationMessages(record: Record<string, unknown>, warnings: string[]) {
  if (isRecord(record.mapping)) {
    return Object.entries(record.mapping)
      .flatMap(([nodeId, node], index) => parseMappingNode(nodeId, node, index, warnings))
      .sort(compareMessages);
  }

  if (Array.isArray(record.messages)) {
    return record.messages
      .flatMap((message, index) => parseFlatMessage(message, index, warnings))
      .sort(compareMessages);
  }

  warnings.push("Conversation has neither mapping nor messages array.");
  return [];
}

function parseMappingNode(
  nodeId: string,
  node: unknown,
  index: number,
  warnings: string[],
): ParsedChatGptMessage[] {
  if (!isRecord(node) || !isRecord(node.message)) {
    return [];
  }

  const message = node.message;
  const text = extractMessageText(message.content);

  if (!text) {
    warnings.push(`Message ${nodeId} has no text content.`);
    return [];
  }

  const id = readString(message.id) ?? nodeId;

  return [
    {
      id,
      sourceId: id,
      role: readRole(readNestedString(message, ["author", "role"])),
      text,
      createdAt: readDate(message.create_time),
      order: index,
    },
  ];
}

function parseFlatMessage(
  message: unknown,
  index: number,
  warnings: string[],
): ParsedChatGptMessage[] {
  if (!isRecord(message)) {
    warnings.push(`Message ${index + 1} is not an object.`);
    return [];
  }

  const text = extractMessageText(message.content ?? message.text);

  if (!text) {
    warnings.push(`Message ${index + 1} has no text content.`);
    return [];
  }

  const id = readString(message.id) ?? `message-${index}`;

  return [
    {
      id,
      sourceId: id,
      role: readRole(readString(message.role) ?? readNestedString(message, ["author", "role"])),
      text,
      createdAt: readDate(message.create_time ?? message.created_at),
      order: index,
    },
  ];
}

function compareMessages(a: ParsedChatGptMessage, b: ParsedChatGptMessage) {
  const aTime = a.createdAt?.getTime();
  const bTime = b.createdAt?.getTime();

  if (aTime !== undefined && bTime !== undefined && aTime !== bTime) {
    return aTime - bTime;
  }

  return a.order - b.order;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!isRecord(content)) {
    return "";
  }

  if (Array.isArray(content.parts)) {
    return content.parts.map(stringifyMessagePart).filter(Boolean).join("\n").trim();
  }

  if (typeof content.text === "string") {
    return content.text.trim();
  }

  return "";
}

function stringifyMessagePart(part: unknown) {
  if (typeof part === "string") {
    return part.trim();
  }

  if (isRecord(part)) {
    return JSON.stringify(part);
  }

  return "";
}

function formatConversationTranscript(messages: ParsedChatGptMessage[]) {
  return messages
    .map((message) => {
      const timestamp = message.createdAt?.toISOString() ?? "unknown-time";
      return `[${message.order}] ${timestamp} ${message.role}\n${message.text}`;
    })
    .join("\n\n");
}

function readRole(value: string | undefined): ChatGptMessageRole {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") {
    return value;
  }

  return "unknown";
}

function readDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000);
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNestedString(record: Record<string, unknown>, path: string[]) {
  let value: unknown = record;

  for (const segment of path) {
    if (!isRecord(value)) {
      return undefined;
    }

    value = value[segment];
  }

  return readString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
