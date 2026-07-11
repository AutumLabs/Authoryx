import { AccessDeniedError, AuthoryxOSError } from "authoryxos";
import { client } from "./runtime.js";

export interface FetchSecretInput {
  key: string;
  intent: string;
}

export interface FetchSecretResult {
  ok: boolean;
  /** Revealed secret value. Returned only to the MCP client, never logged. */
  value?: string;
  error?: { code: string; message: string };
}

/**
 * Implementation of the `authoryxos_fetch_secret` tool.
 *
 * The MCP server exposes this to Claude Code. The `intent` argument is
 * mandatory and is what the AuthoryxOS owner reads to approve or deny
 * the fetch. AccessDeniedError and other AuthoryxOSError subclasses are
 * mapped to structured error results instead of being thrown — Claude
 * Code should read them and decide how to proceed.
 */
export async function fetchSecret(input: FetchSecretInput): Promise<FetchSecretResult> {
  if (!input.key || !input.intent) {
    return {
      ok: false,
      error: { code: "invalid_intent", message: "Both 'key' and 'intent' are required." },
    };
  }
  try {
    const s = await client().fetch({ key: input.key, intent: input.intent });
    const result: FetchSecretResult = { ok: true, value: s.reveal() };
    s.zero();
    return result;
  } catch (e) {
    if (e instanceof AccessDeniedError) {
      return { ok: false, error: { code: "denied", message: e.reason || "denied" } };
    }
    if (e instanceof AuthoryxOSError) {
      return { ok: false, error: { code: e.name, message: e.message } };
    }
    throw e;
  }
}
