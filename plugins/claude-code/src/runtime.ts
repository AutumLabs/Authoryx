import { Client } from "authoryxos";

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
      "AuthoryxOS MCP server not configured. Set AUTHORYXOS_API_KEY before starting.",
    );
  }
  return _client;
}

/** Attach a pre-built Client. Useful for tests. */
export function attach(c: Client): void {
  _client = c;
}

/** Test-only reset. */
export function _reset(): void {
  _client = undefined;
}
