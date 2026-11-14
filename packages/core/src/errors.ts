/**
 * One sentence and one exit status per refusal (FR-019). Every surface shows
 * the same sentence; the command-line tool exits with the status. A sentence
 * may name a key name and the API's code, never a value or a key.
 */
import { AuthoryxError } from "@authoryx/sdk";

export const EXIT = {
  ok: 0,
  usage: 64,
  failure: 70,
  unauthorized: 71,
  notFound: 72,
  notApproved: 73,
  denied: 74,
  expired: 75,
  limit: 76,
  apiOff: 77,
  version: 78,
} as const;

export class ToolError extends Error {
  override readonly name = "ToolError";
  constructor(
    message: string,
    readonly code: string,
    readonly exit: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export const usage = (message: string, details: Record<string, unknown> = {}) => new ToolError(message, "AUTHORYX_USAGE", EXIT.usage, details);

export const UPGRADE = "npm install -g authoryx@latest";

/** Turn anything thrown below a tool into a ToolError with the contract's sentence. */
export function toToolError(e: unknown, ctx: { keyName?: string; apiUrl?: string } = {}): ToolError {
  if (e instanceof ToolError) return e;
  if (!(e instanceof AuthoryxError)) {
    return new ToolError(`Something went wrong: ${(e as Error)?.message ?? String(e)}`, "AUTHORYX_FAILURE", EXIT.failure);
  }
  const key = ctx.keyName ? `${ctx.keyName}: ` : "";
  switch (e.kind) {
    case "unauthorized":
      return new ToolError(
        "The Authoryx API did not accept this agent's id and key. Sign in again with `authoryx login`, or check AUTHORYX_AGENT_ID and AUTHORYX_AGENT_KEY.",
        e.code,
        EXIT.unauthorized,
      );
    case "not_found":
      return new ToolError(`${key}${e.message} It does not exist, or this agent cannot reach it.`, e.code, EXIT.notFound);
    case "not_approved":
      return new ToolError(
        `${key}not approved for use in this request (${e.state ?? "not approved"}). ${e.state === "pending" ? "Wait for the owner's answer." : "Open a new request to ask again."}`,
        e.code,
        EXIT.notApproved,
        e.state ? { state: e.state } : {},
      );
    case "pending_limit":
      return new ToolError(`${e.message} Wait for an answer, or close one you no longer need.`, e.code, EXIT.limit);
    case "rate_limited":
      return new ToolError(
        `Too many calls from this agent; the limit is 120 a minute.${e.retryAfter ? ` Try again in ${e.retryAfter} seconds.` : " Try again in a minute."}`,
        e.code,
        EXIT.limit,
      );
    case "api_off":
      return new ToolError("The Authoryx agent API is switched off right now. Try again later.", e.code, EXIT.apiOff);
    case "unavailable":
      return new ToolError("The Authoryx API could not complete this call. Try again.", e.code, EXIT.failure);
    case "version_unsupported":
      return new ToolError(`${e.message} Run: ${UPGRADE}`, e.code, EXIT.version);
    case "network":
      return new ToolError(`Could not reach the Authoryx API${ctx.apiUrl ? ` at ${ctx.apiUrl}` : ""}. Check the address and your connection.`, e.code, EXIT.failure);
    case "invalid":
    default:
      return new ToolError(`The Authoryx API refused the request as not valid${e.field ? ` (${e.field})` : ""}.`, e.code, EXIT.usage);
  }
}
