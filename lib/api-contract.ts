export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTEGRATION_FAILURE"
  | "AI_FAILURE"
  | "JOB_NOT_READY"
  | "CONFLICT"
  | "INTERNAL_SERVER_ERROR";

export type ApiErrorPayload = {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
};

export type ApiErrorResponse = {
  ok: false;
  requestId: string;
  error: ApiErrorPayload;
};

export type ApiSuccessResponse<TData> = {
  ok: true;
  requestId: string;
  data: TData;
};

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export const apiErrorMessages: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: "Please check the submitted fields.",
  UNAUTHORIZED: "Please sign in to continue.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  RATE_LIMITED: "Too many requests. Please try again shortly.",
  INTEGRATION_FAILURE: "The external integration is currently unavailable.",
  AI_FAILURE: "The AI service could not complete the request.",
  JOB_NOT_READY: "The job is still processing. Please poll again shortly.",
  CONFLICT: "The request conflicts with the current resource state.",
  INTERNAL_SERVER_ERROR: "Internal server error.",
};

export function isApiErrorResponse(payload: unknown): payload is ApiErrorResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<ApiErrorResponse>;
  return candidate.ok === false && typeof candidate.requestId === "string" && !!candidate.error;
}

export function getFriendlyApiErrorMessage(payload: unknown, fallback = "Request failed.") {
  if (!isApiErrorResponse(payload)) {
    return fallback;
  }

  return payload.error.message || apiErrorMessages[payload.error.code] || fallback;
}
