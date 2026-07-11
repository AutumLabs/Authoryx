import { Client } from "authoryxos";

/**
 * Lazily-constructed singleton client. OpenClaw calls plugin hooks before
 * the first tool invocation; we defer wiring until config is known.
 */
let _client: Client | undefined;

export interface PluginConfig {
  apiKey: string;
  baseUrl?: string;
  agentId?: string;
  sessionId?: string;
}

export function configure(cfg: PluginConfig): Client {
  _client = new Client({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl ?? "https://api.authoryx.dev",
    ...(cfg.agentId ? { agentId: cfg.agentId } : {}),
    ...(cfg.sessionId ? { sessionId: cfg.sessionId } : {}),
  });
  return _client;
}

export function client(): Client {
  if (!_client) {
    throw new Error(
      "AuthoryxOS plugin not configured. Set AUTHORYXOS_API_KEY before first use.",
    );
  }
  return _client;
}

/** Attach a pre-built Client. Useful for tests and embedded use. */
export function attach(c: Client): void {
  _client = c;
}

/** Test-only reset. */
export function _reset(): void {
  _client = undefined;
}
