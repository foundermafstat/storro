import type { ApiErrorCode } from "@/lib/api-contract";

export class ServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(input: {
    code: ApiErrorCode;
    statusCode: number;
    message: string;
    details?: unknown;
    expose?: boolean;
  }) {
    super(input.message);
    this.name = "ServiceError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.details = input.details;
    this.expose = input.expose ?? input.statusCode < 500;
  }
}

export class ValidationServiceError extends ServiceError {
  constructor(message = "Invalid request.", details?: unknown) {
    super({
      code: "VALIDATION_FAILED",
      statusCode: 400,
      message,
      details,
      expose: true,
    });
    this.name = "ValidationServiceError";
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message = "Authentication is required.") {
    super({
      code: "UNAUTHORIZED",
      statusCode: 401,
      message,
      expose: true,
    });
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends ServiceError {
  constructor(message = "Forbidden") {
    super({
      code: "FORBIDDEN",
      statusCode: 403,
      message,
      expose: true,
    });
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = "Not found") {
    super({
      code: "NOT_FOUND",
      statusCode: 404,
      message,
      expose: true,
    });
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends ServiceError {
  constructor(message = "Too many requests.", details?: unknown) {
    super({
      code: "RATE_LIMITED",
      statusCode: 429,
      message,
      details,
      expose: true,
    });
    this.name = "RateLimitError";
  }
}

export class IntegrationFailureError extends ServiceError {
  constructor(message = "Integration request failed.", details?: unknown) {
    super({
      code: "INTEGRATION_FAILURE",
      statusCode: 502,
      message,
      details,
      expose: false,
    });
    this.name = "IntegrationFailureError";
  }
}

export class AiFailureError extends ServiceError {
  constructor(message = "AI request failed.", details?: unknown) {
    super({
      code: "AI_FAILURE",
      statusCode: 502,
      message,
      details,
      expose: false,
    });
    this.name = "AiFailureError";
  }
}

export class JobStatusPollingError extends ServiceError {
  constructor(message = "Job is not ready.", details?: unknown) {
    super({
      code: "JOB_NOT_READY",
      statusCode: 409,
      message,
      details,
      expose: true,
    });
    this.name = "JobStatusPollingError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message = "Conflict.", details?: unknown) {
    super({
      code: "CONFLICT",
      statusCode: 409,
      message,
      details,
      expose: true,
    });
    this.name = "ConflictError";
  }
}
