import { prisma } from "@/db/client";
import type { DatabaseClient } from "@/db/transaction";
import type { ServerEnv } from "@/server/env";
import { AiFailureError, ValidationServiceError } from "@/services/errors";
import { requireScopedContext, type ScopedContext } from "@/services/scoped-context";

export type AiGatewayTask = "extraction" | "planning" | "generation" | "grounding" | "summarization";

export type AiGatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiGatewayJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type AiGatewayInput = {
  task: AiGatewayTask;
  projectId?: string;
  messages: AiGatewayMessage[];
  promptVersion: string;
  jsonSchema?: AiGatewayJsonSchema;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
};

export type AiGatewayProviderRequest = {
  model: string;
  messages: AiGatewayMessage[];
  jsonSchema?: AiGatewayJsonSchema;
  promptVersion: string;
  signal: AbortSignal;
};

export type AiGatewayProviderResponse = {
  id: string;
  status: string;
  outputText?: string;
  outputParsed?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export type AiGatewayProvider = {
  createResponse(request: AiGatewayProviderRequest): Promise<AiGatewayProviderResponse>;
};

export type AiModelPolicy = Record<AiGatewayTask, string>;

export function createAiModelPolicy(env: Pick<ServerEnv, "OPENAI_MODEL_EXTRACTION" | "OPENAI_MODEL_GENERATION">): AiModelPolicy {
  return {
    extraction: env.OPENAI_MODEL_EXTRACTION,
    planning: env.OPENAI_MODEL_GENERATION,
    generation: env.OPENAI_MODEL_GENERATION,
    grounding: env.OPENAI_MODEL_EXTRACTION,
    summarization: env.OPENAI_MODEL_GENERATION,
  };
}

export class OpenAiResponsesProvider implements AiGatewayProvider {
  constructor(private readonly apiKey: string) {}

  async createResponse(request: AiGatewayProviderRequest): Promise<AiGatewayProviderResponse> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        input: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        text: request.jsonSchema
          ? {
              format: {
                type: "json_schema",
                name: request.jsonSchema.name,
                schema: request.jsonSchema.schema,
                strict: request.jsonSchema.strict ?? true,
              },
            }
          : undefined,
        metadata: {
          promptVersion: request.promptVersion,
        },
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new AiFailureError("OpenAI Responses API request failed.", {
        status: response.status,
        body: await response.text(),
      });
    }

    const payload = (await response.json()) as Record<string, unknown>;

    return {
      id: String(payload.id ?? ""),
      status: String(payload.status ?? "unknown"),
      outputText: extractOutputText(payload),
      outputParsed: payload.output_parsed,
      usage: readUsage(payload.usage),
    };
  }
}

export async function callAiGateway(
  context: ScopedContext,
  input: AiGatewayInput,
  provider: AiGatewayProvider,
  modelPolicy: AiModelPolicy,
  db: DatabaseClient = prisma,
) {
  requireScopedContext(context);
  validateAiInput(input);

  const timeoutMs = input.timeoutMs ?? 60_000;
  const maxRetries = input.maxRetries ?? 2;
  const backoffMs = input.backoffMs ?? 250;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await provider.createResponse({
        model: modelPolicy[input.task],
        messages: input.messages,
        jsonSchema: input.jsonSchema,
        promptVersion: input.promptVersion,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const parsed = parseGatewayOutput(response, input.jsonSchema);
      await recordAiUsage(context, input, response, db);

      return {
        response,
        parsed,
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = normalizeGatewayError(error);

      if (attempt >= maxRetries || !isRetryableError(lastError)) {
        throw lastError;
      }

      await delay(backoffMs * (attempt + 1));
    }
  }

  throw normalizeGatewayError(lastError);
}

function validateAiInput(input: AiGatewayInput) {
  if (input.messages.length === 0) {
    throw new ValidationServiceError("AI gateway messages are required.");
  }

  if (!input.promptVersion.trim()) {
    throw new ValidationServiceError("AI prompt version is required.");
  }
}

function parseGatewayOutput(response: AiGatewayProviderResponse, schema?: AiGatewayJsonSchema) {
  if (!schema) {
    return response.outputParsed ?? response.outputText ?? "";
  }

  if (response.outputParsed !== undefined) {
    return response.outputParsed;
  }

  if (!response.outputText) {
    throw new AiFailureError("Structured output parse failed.", {
      reason: "empty_output",
    });
  }

  try {
    return JSON.parse(response.outputText) as unknown;
  } catch (error) {
    throw new AiFailureError("Structured output parse failed.", {
      reason: error instanceof Error ? error.message : "invalid_json",
    });
  }
}

async function recordAiUsage(
  context: ScopedContext,
  input: AiGatewayInput,
  response: AiGatewayProviderResponse,
  db: DatabaseClient,
) {
  await db.usageEvent.create({
    data: {
      orgId: context.orgId,
      projectId: input.projectId,
      userId: context.userId,
      type: input.task === "generation" ? "AI_GENERATION" : "AI_EXTRACTION",
      quantity: response.usage?.totalTokens ?? 1,
      metadata: {
        responseId: response.id,
        status: response.status,
        task: input.task,
        promptVersion: input.promptVersion,
        usage: response.usage,
      },
    },
  });
}

function normalizeGatewayError(error: unknown) {
  if (error instanceof AiFailureError || error instanceof ValidationServiceError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new AiFailureError("AI request timed out.");
  }

  return new AiFailureError("AI gateway request failed.", {
    reason: error instanceof Error ? error.message : String(error),
  });
}

function isRetryableError(error: unknown) {
  return error instanceof AiFailureError;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return undefined;
  }

  return payload.output
    .flatMap((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
    .flatMap((content) => (isRecord(content) && typeof content.text === "string" ? [content.text] : []))
    .join("\n");
}

function readUsage(value: unknown): AiGatewayProviderResponse["usage"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    inputTokens: readNumber(value.input_tokens),
    outputTokens: readNumber(value.output_tokens),
    totalTokens: readNumber(value.total_tokens),
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
