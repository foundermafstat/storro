import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getFriendlyApiErrorMessage } from "@/lib/api-contract";
import { createApiRoute } from "@/server/api/route-handler";
import { AuthenticationError, AuthorizationError } from "@/services/errors";

function createRequest(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://storro.test${path}`, init);
}

describe("api route handler", () => {
  it("returns typed success responses with request ids", async () => {
    const logger = vi.fn();
    const route = createApiRoute({
      bodySchema: z.object({
        name: z.string().min(1),
      }),
      logger,
      handler: ({ body }) => ({
        greeting: `Hello ${body.name}`,
      }),
    });

    const response = await route(
      createRequest("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_123",
        },
        body: JSON.stringify({ name: "Storro" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_123");
    expect(payload).toEqual({
      ok: true,
      requestId: "req_123",
      data: {
        greeting: "Hello Storro",
      },
    });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ level: "info", statusCode: 200 }));
  });

  it("maps invalid payloads to structured validation errors", async () => {
    const route = createApiRoute({
      bodySchema: z.object({
        name: z.string().min(3),
      }),
      logger: vi.fn(),
      handler: ({ body }) => body,
    });

    const response = await route(
      createRequest("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_validation",
        },
        body: JSON.stringify({ name: "" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.requestId).toBe("req_validation");
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(payload.error.details.issues[0]).toMatchObject({
      path: "body.name",
    });
    expect(getFriendlyApiErrorMessage(payload)).toBe("Invalid request.");
  });

  it("maps unauthorized service errors", async () => {
    const route = createApiRoute({
      logger: vi.fn(),
      handler: () => {
        throw new AuthenticationError();
      },
    });

    const response = await route(createRequest("/api/projects", { headers: { "x-request-id": "req_auth" } }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req_auth",
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    });
  });

  it("maps forbidden service errors", async () => {
    const route = createApiRoute({
      logger: vi.fn(),
      handler: () => {
        throw new AuthorizationError("Missing project.write permission.");
      },
    });

    const response = await route(createRequest("/api/projects", { headers: { "x-request-id": "req_forbidden" } }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Missing project.write permission.",
    });
  });

  it("hides internal errors behind a stable error contract", async () => {
    const logger = vi.fn();
    const route = createApiRoute({
      logger,
      handler: () => {
        throw new Error("database password leaked in stack");
      },
    });

    const response = await route(createRequest("/api/projects", { headers: { "x-request-id": "req_internal" } }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      ok: false,
      requestId: "req_internal",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error.",
      },
    });
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ level: "error", errorCode: "INTERNAL_SERVER_ERROR" }));
  });
});
