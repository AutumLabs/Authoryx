/**
 * One error type for every refusal, with a `kind` a caller can switch on. The
 * message is the API's own sentence for the code; it never carries a value or
 * a key, because the API's answers never do and nothing here adds one.
 */

export type ErrorKind =
  | "unauthorized"
  | "not_found"
  | "not_approved"
  | "pending_limit"
  | "rate_limited"
  | "api_off"
  | "unavailable"
  | "invalid"
  | "version_unsupported"
  | "network";

const KIND_BY_CODE: Record<string, ErrorKind> = {
  AGENT_INVALID: "invalid",
  AGENT_UNAUTHORIZED: "unauthorized",
  AGENT_NOT_APPROVED: "not_approved",
  AGENT_NOT_FOUND: "not_found",
  AGENT_PENDING_LIMIT: "pending_limit",
  RATE_LIMIT_EXCEEDED: "rate_limited",
  AGENT_API_OFF: "api_off",
  AGENT_UNAVAILABLE: "unavailable",
};

export class AuthoryxError extends Error {
  override readonly name = "AuthoryxError";
  readonly kind: ErrorKind;
  /** The API's code, e.g. AGENT_NOT_APPROVED; for local failures, AUTHORYX_*. */
  readonly code: string;
  /** HTTP status, or 0 when the API was not reached. */
  readonly status: number;
  /** For not_approved: pending, denied, expired or closed. */
  readonly state?: string;
  /** For invalid: the field the API named. */
  readonly field?: string;
  /** For rate_limited: seconds until a retry may succeed. */
  readonly retryAfter?: number;

  constructor(init: { kind: ErrorKind; code: string; status: number; message: string; state?: string; field?: string; retryAfter?: number }) {
    super(init.message);
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    if (init.state !== undefined) this.state = init.state;
    if (init.field !== undefined) this.field = init.field;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
  }

  /** Build from an API refusal body `{ success: false, data: { error, code, state?, field? } }`. */
  static fromResponse(status: number, body: unknown, retryAfter?: number): AuthoryxError {
    const data = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
    const code = typeof data.code === "string" ? data.code : `HTTP_${status}`;
    const message = typeof data.error === "string" ? data.error : `The agent API answered ${status}.`;
    const kind = KIND_BY_CODE[code] ?? (status === 401 ? "unauthorized" : status === 404 ? "not_found" : status >= 500 ? "unavailable" : "invalid");
    return new AuthoryxError({
      kind,
      code,
      status,
      message,
      ...(typeof data.state === "string" ? { state: data.state } : {}),
      ...(typeof data.field === "string" ? { field: data.field } : {}),
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    });
  }
}
