/**
 * The Authoryx agent API client. No runtime dependency: Node's own fetch.
 *
 * Every call signs in with the agent id and key, sends a user agent naming this
 * package and its version and nothing about the machine or the person, and
 * turns a refusal into an AuthoryxError. A 429 with a reset is waited out and
 * retried, for at most `maxRetryWaitSeconds` in total.
 *
 * `fetch()` is the one call that returns a value. It is T1, "Fetch for
 * scripts": the value reaches the program that called it. Code that runs inside
 * an agent's conversation should use `authoryx run` or the MCP server instead,
 * which hand the value to a child program and return only redacted output.
 */
import { AuthoryxError } from "./errors.js";
import type { Circle, Hint, Outcome, Request, Share, SharedVault, Value, WhoAmI } from "./types.js";
import { VERSION } from "./version.js";

/** Agent API versions this release understands. */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

export const AGENT_API_PATH = "/agent/v1/os";

export interface CallEvent {
  method: string;
  /** The route with ids, e.g. /requests/0b6…/fetch. Never a body, header or key. */
  route: string;
  status: number;
  durationMs: number;
}

export interface AuthoryxOptions {
  agentId: string;
  agentKey: string;
  /** The Authoryx API's address, e.g. https://api.example.com. */
  apiUrl: string;
  /** Defaults to `authoryx-sdk-ts/<version>`. */
  userAgent?: string;
  /** Total seconds to spend waiting out 429s before giving up. Default 60; 0 disables retry. */
  maxRetryWaitSeconds?: number;
  /** Called after each HTTP call, for debug logging. */
  onCall?: (e: CallEvent) => void;
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class Authoryx {
  readonly apiUrl: string;
  readonly agentId: string;
  readonly #key: string;
  readonly #userAgent: string;
  readonly #maxRetryWait: number;
  readonly #onCall: ((e: CallEvent) => void) | undefined;
  readonly #fetch: typeof globalThis.fetch;

  constructor(opts: AuthoryxOptions) {
    if (!opts.agentId) throw localError("invalid", "AUTHORYX_NO_AGENT", "An agent id is required.");
    if (!opts.agentKey) throw localError("invalid", "AUTHORYX_NO_KEY", "An agent key is required.");
    if (!opts.apiUrl) throw localError("invalid", "AUTHORYX_NO_API", "The Authoryx API address is required.");
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.agentId = opts.agentId;
    this.#key = opts.agentKey;
    this.#userAgent = opts.userAgent ?? `authoryx-sdk-ts/${VERSION}`;
    this.#maxRetryWait = opts.maxRetryWaitSeconds ?? 60;
    this.#onCall = opts.onCall;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  /** Never print the key, even by accident. */
  toJSON(): Record<string, string> {
    return { apiUrl: this.apiUrl, agentId: this.agentId };
  }

  /**
   * Who this agent is. Raises `version_unsupported` when the API speaks a
   * version this release does not, so tools stop before any other call.
   */
  async whoami(): Promise<WhoAmI> {
    const me = await this.#call<WhoAmI>("GET", "/whoami");
    if (!SUPPORTED_API_VERSIONS.includes(me.apiVersion)) {
      throw new AuthoryxError({
        kind: "version_unsupported",
        code: "AUTHORYX_VERSION_UNSUPPORTED",
        status: 0,
        message: `The Authoryx API speaks version ${me.apiVersion}; this release supports ${SUPPORTED_API_VERSIONS.join(", ")}. Upgrade the Authoryx tools.`,
      });
    }
    return me;
  }

  async circles(): Promise<Circle[]> {
    return (await this.#call<{ circles: Circle[] }>("GET", "/circles")).circles;
  }

  async secrets(circleId: string): Promise<{ secrets: Share[]; vaults: SharedVault[] }> {
    return this.#call("GET", `/circles/${encodeURIComponent(circleId)}/secrets`);
  }

  async request(input: { circleId: string; keyNames: string[]; reason: string; hint?: Hint }): Promise<Request> {
    const body: Record<string, unknown> = { circleId: input.circleId, keyNames: input.keyNames, reason: input.reason };
    if (input.hint) body.hint = input.hint;
    return (await this.#call<{ request: Request }>("POST", "/requests", body)).request;
  }

  async getRequest(id: string): Promise<Request> {
    return (await this.#call<{ request: Request }>("GET", `/requests/${encodeURIComponent(id)}`)).request;
  }

  /**
   * Read the request until it is no longer pending or `seconds` pass, at most
   * once every `intervalMs` (default 2 s). Returns the last state read.
   */
  async waitForRequest(id: string, opts: { seconds?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<Request> {
    const deadline = Date.now() + Math.max(0, opts.seconds ?? 60) * 1000;
    const interval = Math.max(10, opts.intervalMs ?? 2000);
    let r = await this.getRequest(id);
    while (r.state === "pending" && Date.now() < deadline) {
      await sleep(Math.min(interval, Math.max(0, deadline - Date.now())), opts.signal);
      r = await this.getRequest(id);
    }
    return r;
  }

  async closeRequest(id: string, outcome: Outcome): Promise<Request> {
    return (await this.#call<{ request: Request }>("POST", `/requests/${encodeURIComponent(id)}/close`, { outcome })).request;
  }

  /** T1, Fetch for scripts: the value reaches this program. */
  async fetch(requestId: string, keyName: string): Promise<Value> {
    return (await this.#call<{ value: Value }>("POST", `/requests/${encodeURIComponent(requestId)}/fetch`, { keyName })).value;
  }

  async #call<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    let waited = 0;
    for (;;) {
      const started = Date.now();
      let res: Response;
      try {
        res = await this.#fetch(`${this.apiUrl}${AGENT_API_PATH}${route}`, {
          method,
          headers: {
            "Authoryx-Agent": this.agentId,
            Authorization: `Bearer ${this.#key}`,
            "User-Agent": this.#userAgent,
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (e) {
        this.#onCall?.({ method, route, status: 0, durationMs: Date.now() - started });
        throw localError("network", "AUTHORYX_NETWORK", `Could not reach the Authoryx API at ${this.apiUrl}: ${(e as Error).message}`);
      }
      this.#onCall?.({ method, route, status: res.status, durationMs: Date.now() - started });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* a non-JSON answer is reported by status below */
      }
      if (res.ok && (json as { success?: boolean } | null)?.success) return (json as { data: T }).data;

      const reset = retrySeconds(res.headers);
      const err = AuthoryxError.fromResponse(res.status, json, reset);
      if (err.kind === "rate_limited" && reset !== undefined && waited + reset <= this.#maxRetryWait) {
        waited += reset;
        await sleep(reset * 1000);
        continue;
      }
      throw err;
    }
  }
}

function retrySeconds(h: Headers): number | undefined {
  for (const name of ["ratelimit-reset", "retry-after"]) {
    const v = h.get(name);
    if (v && /^\d+$/.test(v.trim())) return Math.max(1, Number(v));
  }
  return undefined;
}

function localError(kind: AuthoryxError["kind"], code: string, message: string): AuthoryxError {
  return new AuthoryxError({ kind, code, status: 0, message });
}
