import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/client";
import {
  callAiGateway,
  type AiGatewayProvider,
  type AiGatewayProviderRequest,
  type AiGatewayProviderResponse,
  createAiModelPolicy,
} from "@/services/ai-gateway";
import { AiFailureError } from "@/services/errors";
import { createProject } from "@/services/project-service";
import type { ScopedContext } from "@/services/scoped-context";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let orgId = "";
let userId = "";
let projectId = "";
let context: ScopedContext;

const modelPolicy = createAiModelPolicy({
  OPENAI_MODEL_EXTRACTION: "gpt-test-extraction",
  OPENAI_MODEL_GENERATION: "gpt-test-generation",
});

class FakeProvider implements AiGatewayProvider {
  calls: AiGatewayProviderRequest[] = [];

  constructor(private readonly responses: Array<AiGatewayProviderResponse | Error>) {}

  async createResponse(request: AiGatewayProviderRequest) {
    this.calls.push(request);
    const next = this.responses.shift();

    if (next instanceof Error) {
      throw next;
    }

    return (
      next ?? {
        id: "resp_default",
        status: "completed",
        outputText: "ok",
      }
    );
  }
}

describe("AI gateway", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        authUserId: `ai-user-${suffix}`,
        email: `ai-user-${suffix}@storro.local`,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: `AI Org ${suffix}`,
        slug: `ai-org-${suffix}`,
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
      name: `AI Project ${suffix}`,
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

  it("routes model calls through the provider and records usage events", async () => {
    const provider = new FakeProvider([
      {
        id: "resp_1",
        status: "completed",
        outputParsed: { facts: ["one"] },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    ]);

    const result = await callAiGateway(
      context,
      {
        task: "extraction",
        projectId,
        promptVersion: "extract.v1",
        messages: [{ role: "user", content: "Extract facts" }],
        jsonSchema: {
          name: "facts",
          schema: {
            type: "object",
            properties: {
              facts: { type: "array", items: { type: "string" } },
            },
            required: ["facts"],
            additionalProperties: false,
          },
        },
      },
      provider,
      modelPolicy,
    );

    expect(result.parsed).toEqual({ facts: ["one"] });
    expect(provider.calls[0]?.model).toBe("gpt-test-extraction");

    const usage = await prisma.usageEvent.findFirstOrThrow({
      where: {
        orgId,
        projectId,
        type: "AI_EXTRACTION",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(usage.quantity).toBe(15);
    expect(usage.metadata).toMatchObject({
      responseId: "resp_1",
      task: "extraction",
      promptVersion: "extract.v1",
    });
  });

  it("retries retryable provider failures", async () => {
    const provider = new FakeProvider([
      new AiFailureError("temporary"),
      {
        id: "resp_retry",
        status: "completed",
        outputText: "retry ok",
      },
    ]);

    const result = await callAiGateway(
      context,
      {
        task: "generation",
        projectId,
        promptVersion: "generation.v1",
        messages: [{ role: "user", content: "Write update" }],
        backoffMs: 0,
      },
      provider,
      modelPolicy,
    );

    expect(result.parsed).toBe("retry ok");
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.model).toBe("gpt-test-generation");
  });

  it("turns timeouts into controlled AI failures", async () => {
    const provider: AiGatewayProvider = {
      async createResponse(request) {
        await new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
        throw new Error("unreachable");
      },
    };

    await expect(
      callAiGateway(
        context,
        {
          task: "summarization",
          projectId,
          promptVersion: "summary.v1",
          messages: [{ role: "user", content: "Summarize" }],
          timeoutMs: 5,
          maxRetries: 0,
        },
        provider,
        modelPolicy,
      ),
    ).rejects.toThrow("AI request timed out.");
  });

  it("turns structured parse failures into controlled job errors", async () => {
    const provider = new FakeProvider([
      {
        id: "resp_bad_json",
        status: "completed",
        outputText: "{bad json",
      },
    ]);

    await expect(
      callAiGateway(
        context,
        {
          task: "planning",
          projectId,
          promptVersion: "planning.v1",
          messages: [{ role: "user", content: "Plan" }],
          jsonSchema: {
            name: "plan",
            schema: {
              type: "object",
              properties: {
                steps: { type: "array", items: { type: "string" } },
              },
              required: ["steps"],
              additionalProperties: false,
            },
          },
        },
        provider,
        modelPolicy,
      ),
    ).rejects.toThrow("Structured output parse failed.");
  });
});
