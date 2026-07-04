export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
