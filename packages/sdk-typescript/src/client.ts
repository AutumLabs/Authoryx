import { setTimeout as sleep } from "node:timers/promises";
import {
  AccessDeniedError,
  AuthoryxOSError,
  PendingTimeoutError,
  TransportError,
} from "./errors.js";
import { build, type PolicyHint } from "./intent.js";
import { PauseStore, type PendingRow } from "./pause.js";
import { SecretStr } from "./secretstr.js";

const DEFAULT_TIMEOUT_S = 3600;
const DEFAULT_POLL_S = 5;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  agentId?: string;
  sessionId?: string;
  timeoutSeconds?: number;
  pauseStore?: PauseStore;
  fetch?: typeof globalThis.fetch;
}

export interface FetchArgs {
  key: string;
  intent: string;
  policy?: PolicyHint;
}

export interface WithSecretArgs<T> extends FetchArgs {
  exec: (secret: string) => T | Promise<T>;
}

interface ErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}

function mapError(body: ErrorBody | undefined, status: number, token = ""): Error {
  const code = body?.error?.code ?? `http_${status}`;
  const message = body?.error?.message ?? `HTTP ${status}`;
  const retryable = Boolean(body?.error?.retryable);
  if (code === "denied") {
    return new AccessDeniedError(message, { reason: message, token });
  }
  return new TransportError(message, { code, retryable });
}

export class Client {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly agentId: string | undefined;
  readonly sessionId: string | undefined;
  readonly timeoutSeconds: number;
  readonly pause: PauseStore;
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.authoryx.dev").replace(/\/+$/, "");
    this.agentId = opts.agentId;
    this.sessionId = opts.sessionId;
    this.timeoutSeconds = opts.timeoutSeconds ?? DEFAULT_TIMEOUT_S;
    this.pause = opts.pauseStore ?? new PauseStore();
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  async fetch(args: FetchArgs): Promise<SecretStr> {
    const req = build({
      apiKey: this.apiKey,
      keyName: args.key,
      intent: args.intent,
      agentId: this.agentId,
      sessionId: this.sessionId,
      policy: args.policy,
    });
    const url = `${this.baseUrl}/v1/os/secrets/${args.key}`;
    const { status, body } = await this.#request("POST", url, req);
    return this.#resolve(status, body, args.key, req.agent_id, req.session_id);
  }

  async withSecret<T>(args: WithSecretArgs<T>): Promise<T> {
    const s = await this.fetch({ key: args.key, intent: args.intent, ...(args.policy ? { policy: args.policy } : {}) });
    try {
      return await args.exec(s.reveal());
    } finally {
      s.zero();
    }
  }

  async resumePending(): Promise<Array<{ token: string; result: SecretStr | AuthoryxOSError }>> {
    const out: Array<{ token: string; result: SecretStr | AuthoryxOSError }> = [];
    for (const row of this.pause.all()) {
      if (row.base_url !== this.baseUrl) continue;
      try {
        out.push({ token: row.token, result: await this.#poll(row) });
      } catch (e) {
        if (e instanceof AuthoryxOSError) out.push({ token: row.token, result: e });
        else throw e;
      }
    }
    return out;
  }

  async #request(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let resp: Response;
    try {
      resp = await this.#fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new TransportError(`network error: ${(e as Error).name}`, {
        code: "network",
        retryable: true,
      });
    }
    let parsed: Record<string, unknown> = {};
    const text = await resp.text();
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new TransportError("invalid JSON response", { code: "invalid_response" });
      }
    }
    return { status: resp.status, body: parsed };
  }

  async #resolve(
    status: number,
    body: Record<string, unknown>,
    keyName: string,
    agentId: string,
    sessionId: string,
  ): Promise<SecretStr> {
    if (status >= 400) throw mapError(body as ErrorBody, status);
    const s = body["status"];
    if (s === "approved") {
      return new SecretStr(String(body["secret"] ?? ""));
    }
    if (s === "denied") {
      throw new AccessDeniedError(String(body["reason"] ?? "request denied"), {
        reason: String(body["reason"] ?? ""),
        token: String(body["token"] ?? ""),
      });
    }
    if (s === "pending") {
      const row: PendingRow = {
        token: String(body["token"]),
        base_url: this.baseUrl,
        poll_url: String(body["poll_url"]),
        poll_interval: Number(body["poll_interval_seconds"] ?? DEFAULT_POLL_S),
        expires_at: String(body["expires_at"]),
        key_name: keyName,
        agent_id: agentId,
        session_id: sessionId,
        created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      };
      this.pause.save(row);
      return this.#poll(row);
    }
    throw new TransportError(`unexpected response status: ${String(s)}`, {
      code: "invalid_response",
    });
  }

  async #poll(row: PendingRow): Promise<SecretStr> {
    const url = `${row.base_url}${row.poll_url}`;
    const deadline = Date.now() + this.timeoutSeconds * 1000;
    // Allow first check immediately.
    while (true) {
      const { status, body } = await this.#request("GET", url);
      if (status >= 400) {
        this.pause.delete(row.token);
        throw mapError(body as ErrorBody, status, row.token);
      }
      const s = body["status"];
      if (s === "approved") {
        this.pause.delete(row.token);
        return new SecretStr(String(body["secret"] ?? ""));
      }
      if (s === "denied") {
        this.pause.delete(row.token);
        throw new AccessDeniedError(String(body["reason"] ?? "request denied"), {
          reason: String(body["reason"] ?? ""),
          token: row.token,
        });
      }
      if (Date.now() >= deadline) {
        throw new PendingTimeoutError(`timed out polling for ${row.token}`, {
          token: row.token,
        });
      }
      await sleep(row.poll_interval * 1000);
    }
  }
}
