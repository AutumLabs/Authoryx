import { AccessDeniedError, AuthoryxOSError } from "authoryxos";
import { client } from "./runtime.js";

export interface FetchSecretInput {
  key: string;
  intent: string;
}

export interface FetchSecretResult {
  ok: boolean;
  /** Revealed secret value. Returned to the calling tool path only; not logged. */
  value?: string;
  error?: { code: string; message: string };
}

/**
 * `authoryxos_fetch_secret` tool implementation.
 *
 * The intent string is mandatory and is sent to the AuthoryxOS backend for
 * owner review. If the owner denies the request the tool returns a structured
 * error rather than throwing — the agent should read it and proceed without
 * the secret.
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
