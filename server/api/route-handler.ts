import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import {
  apiErrorMessages,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ApiResponse,
} from "@/lib/api-contract";
import { recordApiMetric, reportErrorToSentry } from "@/services/observability-service";
import { ServiceError, ValidationServiceError } from "@/services/errors";

export type ApiLogEntry = {
  level: "info" | "warn" | "error";
  event: "api.request";
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorCode?: ApiErrorCode;
  errorName?: string;
};

export type ApiLogger = (entry: ApiLogEntry) => void;

export type ApiRouteContext<TParams> = {
  params?: TParams | Promise<TParams>;
};

export type ApiRouteHandlerArgs<TBody, TQuery, TParams> = {
  request: NextRequest;
  requestId: string;
  body: TBody;
  query: TQuery;
  params: TParams | undefined;
};

export type ApiRouteOptions<TBody, TQuery, TParams, TData> = {
  bodySchema?: ZodType<TBody>;
  querySchema?: ZodType<TQuery>;
  successStatus?: number;
  logger?: ApiLogger;
  handler: (args: ApiRouteHandlerArgs<TBody, TQuery, TParams>) => TData | Promise<TData>;
};

type NormalizedApiError = {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  errorName?: string;
};

export function createApiRoute<
  TBody = undefined,
  TQuery = undefined,
  TParams = Record<string, string | string[]>,
  TData = unknown,
>(options: ApiRouteOptions<TBody, TQuery, TParams, TData>) {
  return async function apiRoute(request: NextRequest, context?: ApiRouteContext<TParams>) {
    const requestId = resolveRequestId(request);
    const startedAt = Date.now();
    const path = resolvePath(request);

    try {
      const body = await parseBody(request, options.bodySchema);
      const query = parseQuery(request, options.querySchema);
      const params = await context?.params;
      const data = await options.handler({
        request,
        requestId,
        body,
        query,
        params,
      });
      const statusCode = options.successStatus ?? 200;

      const logEntry = {
        level: "info",
        event: "api.request",
        requestId,
        method: request.method,
        path,
        statusCode,
        durationMs: Date.now() - startedAt,
      } as const;

      logApiRequest(options.logger, logEntry);
      recordApiMetric(logEntry);

      return jsonResponse<TData>({ ok: true, requestId, data }, statusCode, requestId);
    } catch (error) {
      const normalized = normalizeApiError(error);

      const logEntry = {
        level: normalized.statusCode >= 500 ? "error" : "warn",
        event: "api.request",
        requestId,
        method: request.method,
        path,
        statusCode: normalized.statusCode,
        durationMs: Date.now() - startedAt,
        errorCode: normalized.code,
        errorName: normalized.errorName,
      } as const;

      logApiRequest(options.logger, logEntry);
      recordApiMetric(logEntry);

      if (normalized.statusCode >= 500) {
        void reportErrorToSentry(error, {
          requestId,
          method: request.method,
          path,
          statusCode: normalized.statusCode,
        });
      }

      const payload: ApiErrorResponse = {
        ok: false,
        requestId,
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        },
      };

      return jsonResponse(payload, normalized.statusCode, requestId);
    }
  };
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (error instanceof ServiceError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.expose ? error.message : apiErrorMessages[error.code],
      details: error.expose ? error.details : undefined,
      errorName: error.name,
    };
  }

  if (error instanceof ZodError) {
    return normalizeApiError(new ValidationServiceError("Invalid request.", formatZodError(error)));
  }

  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: apiErrorMessages.INTERNAL_SERVER_ERROR,
    errorName: error instanceof Error ? error.name : undefined,
  };
}

function resolveRequestId(request: NextRequest) {
  const incoming = request.headers.get("x-request-id") ?? request.headers.get("x-correlation-id");

  if (incoming && /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming)) {
    return incoming;
  }

  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function resolvePath(request: NextRequest) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

async function parseBody<TBody>(request: NextRequest, schema?: ZodType<TBody>) {
  if (!schema) {
    return undefined as TBody;
  }

  const rawBody = await request.text();
  let payload: unknown = {};

  if (rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      throw new ValidationServiceError("Invalid JSON body.", {
        issues: [
          {
            path: "body",
            message: "Request body must be valid JSON.",
            code: "invalid_json",
          },
        ],
      });
    }
  }

  return parseSchema(schema, payload, "body");
}

function parseQuery<TQuery>(request: NextRequest, schema?: ZodType<TQuery>) {
  if (!schema) {
    return undefined as TQuery;
  }

  const url = new URL(request.url);
  const query: Record<string, string | string[]> = {};

  url.searchParams.forEach((value, key) => {
    const existing = query[key];

    if (!existing) {
      query[key] = value;
      return;
    }

    query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });

  return parseSchema(schema, query, "query");
}

function parseSchema<TValue>(schema: ZodType<TValue>, payload: unknown, source: "body" | "query") {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ValidationServiceError("Invalid request.", formatZodError(parsed.error, source));
  }

  return parsed.data;
}

function formatZodError(error: ZodError, source = "body") {
  return {
    issues: error.issues.map((issue) => ({
      path: [source, ...issue.path.map(String)].join("."),
      message: issue.message,
      code: issue.code,
    })),
  };
}

function jsonResponse<TData>(payload: ApiResponse<TData> | ApiErrorResponse, status: number, requestId: string) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "x-request-id": requestId,
    },
  });
}

function logApiRequest(logger: ApiLogger | undefined, entry: ApiLogEntry) {
  if (logger) {
    logger(entry);
    return;
  }

  const serialized = JSON.stringify(entry);

  if (entry.level === "error") {
    console.error(serialized);
    return;
  }

  if (entry.level === "warn") {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
}
