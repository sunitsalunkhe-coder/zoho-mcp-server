export class ZohoMailError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ZohoMailError";
  }
}

export class ZohoAuthError extends ZohoMailError {
  constructor(message: string) {
    super(message, "AUTH_ERROR", 401);
    this.name = "ZohoAuthError";
  }
}

export class ZohoRateLimitError extends ZohoMailError {
  constructor() {
    super("Rate limit exceeded. Retry in a moment.", "RATE_LIMIT", 429);
    this.name = "ZohoRateLimitError";
  }
}

export class ZohoNotFoundError extends ZohoMailError {
  constructor(resource: string) {
    super(`${resource} not found.`, "NOT_FOUND", 404);
    this.name = "ZohoNotFoundError";
  }
}

export class ZohoValidationError extends ZohoMailError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ZohoValidationError";
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof ZohoMailError) return err.message;
  if (err instanceof Error) return `Unexpected error: ${err.message}`;
  return "An unknown error occurred.";
}
