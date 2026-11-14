/**
 * A stand-in for the Authoryx agent API (protocol/agent-api.md), in memory.
 *
 * Every surface in this repository is tested against it. It answers the seven
 * routes with the contract's shapes and refusals, validates each answer against
 * protocol/schemas before sending it, and exposes controls a test uses to play
 * the secret's owner (approve, deny, expire) or the platform (switch off,
 * rate-limit, change the API version, grant capabilities).
 *
 * It issues its own agent id and key per instance; no real key is ever kept in
 * a fixture.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { assertSchema, type SchemaName } from "./schemas.ts";

type SecretType = "login" | "api_key" | "totp" | "note";
type ItemState = "pending" | "approved" | "denied" | "expired";

export interface FakeSecret {
  keyName: string;
  name: string;
  type: SecretType;
  description?: string | null;
  vault?: { name: string; description: string | null } | null;
  /** api_key, note: the value. totp: the code. login: the password. */
  value: string;
  username?: string | null;
  url?: string | null;
}

export interface FakeCircle {
  id: string;
  name: string;
  description?: string | null;
  secrets: FakeSecret[];
  vaults?: { name: string; description: string | null }[];
}

interface FakeRequest {
  id: string;
  circleId: string;
  state: "pending" | "approved" | "denied" | "expired" | "closed";
  reason: string;
  hint: "once" | "1h" | "always" | null;
  createdAt: Date;
  expiresAt: Date;
  closedAt: Date | null;
  outcome: string | null;
  items: { keyName: string; state: ItemState; usableUntil: Date | null }[];
}

export interface CallRecord {
  method: string;
  path: string;
  status: number;
  userAgent: string;
  /** The raw request headers and body, kept so tests can search them. */
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface FakeApiOptions {
  circles?: FakeCircle[];
  agentName?: string;
  hostKind?: string;
  apiVersion?: number;
  /** Approve every new request at once, as if the owner were waiting. */
  autoApprove?: boolean;
  dashboardUrl?: string;
}

export interface FakeApi {
  readonly url: string;
  readonly agentId: string;
  readonly agentKey: string;
  readonly calls: CallRecord[];
  readonly circles: FakeCircle[];
  approve(requestId: string, keyNames?: string[]): void;
  deny(requestId: string, keyNames?: string[]): void;
  expire(requestId: string): void;
  /** Push an approved item past its fifteen minutes of use. */
  expireUse(requestId: string): void;
  setAutoApprove(on: boolean): void;
  setApiVersion(v: number): void;
  setOff(off: boolean): void;
  setCapabilities(ids: string[] | undefined): void;
  /** The next `count` calls answer 429 RATE_LIMIT_EXCEEDED with `RateLimit-Reset: resetSeconds`. */
  rateLimit(count: number, resetSeconds: number): void;
  /** The last request opened, if any. */
  lastRequestId(): string | null;
  requestState(id: string): FakeRequest["state"] | undefined;
  close(): Promise<void>;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomFrom(alphabet: string, n: number): string {
  const bytes = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[(bytes[i] as number) % alphabet.length];
  return s;
}

export const newAgentId = () => `agt_${randomFrom(BASE32, 26)}`;
export const newAgentKey = () => `axa_${randomFrom(ALNUM, 43)}`;

/** A circle with one secret of every type, and values distinctive enough to search for. */
export function defaultCircles(): FakeCircle[] {
  const tag = randomFrom(ALNUM, 10);
  return [
    {
      id: randomUUID(),
      name: "Deploy",
      description: "Release credentials",
      vaults: [{ name: "CI", description: "Build and release" }],
      secrets: [
        { keyName: "API_TOKEN", name: "Deploy token", type: "api_key", value: `tok_${tag}_planted_api`, vault: { name: "CI", description: "Build and release" } },
        { keyName: "GH_LOGIN", name: "GitHub bot", type: "login", value: `pw_${tag}_planted_pass`, username: "release-bot", url: "https://github.com/login" },
        { keyName: "OTP", name: "Registry 2FA", type: "totp", value: "493817" },
        { keyName: "NOTE", name: "Recovery note", type: "note", value: `note ${tag} planted "quoted" & spaced/value` },
      ],
    },
    { id: randomUUID(), name: "Empty", description: null, secrets: [] },
  ];
}

const PENDING_MS = 5 * 60_000;
const USE_MS = 15 * 60_000;
const UUIDISH = /^[0-9a-f-]{8,64}$/i;

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, string> = {}) {
    super(message);
  }
}
const MESSAGES: Record<string, [number, string]> = {
  AGENT_INVALID: [400, "The request is not valid."],
  AGENT_UNAUTHORIZED: [401, "Agent id or key not accepted."],
  AGENT_NOT_APPROVED: [403, "This secret is not approved for use in this request."],
  AGENT_NOT_FOUND: [404, "Not found."],
  AGENT_PENDING_LIMIT: [429, "This agent already has 5 requests waiting for an answer."],
  AGENT_API_OFF: [503, "The agent API is not available right now."],
};
const refuse = (code: string, extra: Record<string, string> = {}) => {
  const [status, msg] = MESSAGES[code] as [number, string];
  return new Refusal(status, code, msg, extra);
};

export async function startFakeApi(opts: FakeApiOptions = {}): Promise<FakeApi> {
  const agentId = newAgentId();
  const agentKey = newAgentKey();
  const circles = opts.circles ?? defaultCircles();
  const requests = new Map<string, FakeRequest>();
  const calls: CallRecord[] = [];
  const dashboard = opts.dashboardUrl ?? "https://dashboard.example.test";
  let apiVersion = opts.apiVersion ?? 1;
  let autoApprove = opts.autoApprove ?? false;
  let off = false;
  let capabilities: string[] | undefined;
  let limited = 0;
  let limitReset = 1;
  let lastId: string | null = null;

  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  /** Pending past its deadline becomes expired; approved past use stays approved per item but unusable. */
  function settle(r: FakeRequest): void {
    const now = Date.now();
    if (r.state === "pending" && now >= r.expiresAt.getTime()) {
      for (const it of r.items) if (it.state === "pending") it.state = "expired";
      r.state = r.items.some((i) => i.state === "approved") ? "approved" : "expired";
    }
    if (r.state === "approved" || r.state === "pending") {
      for (const it of r.items) {
        if (it.state === "approved" && it.usableUntil && now >= it.usableUntil.getTime()) it.state = "expired";
      }
      if (r.items.every((i) => i.state === "expired" || i.state === "denied")) {
        r.state = r.items.every((i) => i.state === "denied") ? "denied" : "expired";
      }
    }
  }

  function recompute(r: FakeRequest): void {
    if (r.state === "closed") return;
    const states = r.items.map((i) => i.state);
    if (states.includes("pending")) r.state = "pending";
    else if (states.includes("approved")) r.state = "approved";
    else if (states.every((s) => s === "denied")) r.state = "denied";
    else r.state = "expired";
  }

  function view(r: FakeRequest) {
    settle(r);
    const pendingKeys = r.items.filter((i) => i.state === "pending").map((i) => i.keyName);
    const until = r.items.map((i) => i.usableUntil).filter((d): d is Date => !!d);
    return {
      id: r.id,
      circleId: r.circleId,
      state: r.state,
      reason: r.reason,
      hint: r.hint,
      createdAt: iso(r.createdAt),
      expiresAt: iso(r.expiresAt),
      usableUntil: until.length ? iso(new Date(Math.min(...until.map((d) => d.getTime())))) : null,
      closedAt: iso(r.closedAt),
      outcome: r.outcome,
      items: r.items.map((i) => ({ keyName: i.keyName, state: i.state, usableUntil: iso(i.usableUntil) })),
      awaiting: r.state === "pending" && pendingKeys.length ? [{ label: "The secret's owner", keyNames: pendingKeys }] : [],
      approvalUrl: `${dashboard}/r/${r.id}`,
    };
  }

  const circleOf = (id: string) => {
    const c = circles.find((c) => c.id === id);
    if (!c) throw refuse("AGENT_NOT_FOUND");
    return c;
  };
  const requestOf = (id: string) => {
    const r = requests.get(id);
    if (!r) throw refuse("AGENT_NOT_FOUND");
    return r;
  };

  function only(body: Record<string, unknown>, allowed: string[]): void {
    for (const k of Object.keys(body)) if (!allowed.includes(k)) throw refuse("AGENT_INVALID", { field: k });
  }

  async function handle(method: string, path: string, body: Record<string, unknown>): Promise<[number, unknown, SchemaName | null]> {
    const parts = path.split("/").filter(Boolean);
    if (method === "GET" && path === "/whoami") {
      const data: Record<string, unknown> = { agent: { id: agentId, name: opts.agentName ?? "Test agent", hostKind: opts.hostKind ?? "claude-code" }, apiVersion };
      if (capabilities) data.capabilities = capabilities;
      assertSchema("whoami", data);
      return [200, data, null];
    }
    if (method === "GET" && path === "/circles") {
      const out = circles.map((c) => ({ id: c.id, name: c.name, description: c.description ?? null }));
      out.forEach((c) => assertSchema("circle", c));
      return [200, { circles: out }, null];
    }
    if (method === "GET" && parts[0] === "circles" && parts[2] === "secrets" && parts.length === 3) {
      const c = circleOf(parts[1] as string);
      const secrets = c.secrets.map((s) => {
        const live = [...requests.values()].filter((r) => r.circleId === c.id && (settle(r), r.state !== "closed"));
        const allowedIn = live.find((r) => r.items.some((i) => i.keyName === s.keyName && i.state === "approved"));
        const pendingIn = live.find((r) => r.items.some((i) => i.keyName === s.keyName && i.state === "pending"));
        const item = allowedIn?.items.find((i) => i.keyName === s.keyName);
        const access = allowedIn && item?.usableUntil
          ? { state: "allowed", until: item.usableUntil.toISOString(), requestId: allowedIn.id }
          : pendingIn ? { state: "ask", pendingRequestId: pendingIn.id } : { state: "ask" };
        return { keyName: s.keyName, name: s.name, type: s.type, description: s.description ?? null, vault: s.vault ?? null, access };
      });
      secrets.forEach((s) => assertSchema("share", s));
      const vaults = c.vaults ?? [];
      vaults.forEach((v) => assertSchema("shared-vault", v));
      return [200, { secrets, vaults }, null];
    }
    if (method === "POST" && path === "/requests") {
      only(body, ["circleId", "keyNames", "reason", "hint"]);
      const { circleId, keyNames, reason, hint } = body as { circleId?: unknown; keyNames?: unknown; reason?: unknown; hint?: unknown };
      if (typeof circleId !== "string" || !UUIDISH.test(circleId)) throw refuse("AGENT_INVALID", { field: "circleId" });
      if (!Array.isArray(keyNames) || keyNames.length < 1 || keyNames.length > 10 || !keyNames.every((k) => typeof k === "string")) {
        throw refuse("AGENT_INVALID", { field: "keyNames" });
      }
      if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw refuse("AGENT_INVALID", { field: "reason" });
      if (hint !== undefined && hint !== "once" && hint !== "1h" && hint !== "always") throw refuse("AGENT_INVALID", { field: "hint" });
      const c = circleOf(circleId);
      for (const k of keyNames as string[]) if (!c.secrets.some((s) => s.keyName === k)) throw refuse("AGENT_NOT_FOUND");
      const pending = [...requests.values()].filter((r) => (settle(r), r.state === "pending"));
      if (pending.length >= 5) throw refuse("AGENT_PENDING_LIMIT");
      const now = new Date();
      const r: FakeRequest = {
        id: randomUUID(),
        circleId,
        state: "pending",
        reason,
        hint: (hint as FakeRequest["hint"]) ?? null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PENDING_MS),
        closedAt: null,
        outcome: null,
        items: [...new Set(keyNames as string[])].map((keyName) => ({ keyName, state: "pending" as ItemState, usableUntil: null })),
      };
      requests.set(r.id, r);
      lastId = r.id;
      if (autoApprove) approve(r.id);
      const v = view(r);
      assertSchema("request", v);
      return [201, { request: v }, null];
    }
    if (method === "GET" && parts[0] === "requests" && parts.length === 2) {
      const v = view(requestOf(parts[1] as string));
      assertSchema("request", v);
      return [200, { request: v }, null];
    }
    if (method === "POST" && parts[0] === "requests" && parts[2] === "close" && parts.length === 3) {
      only(body, ["outcome"]);
      const r = requestOf(parts[1] as string);
      const outcome = body.outcome;
      if (outcome !== "done" && outcome !== "abandoned" && outcome !== "failed") throw refuse("AGENT_INVALID", { field: "outcome" });
      if (r.state !== "closed") {
        settle(r);
        r.state = "closed";
        r.closedAt = new Date();
        r.outcome = outcome;
      }
      const v = view(r);
      assertSchema("request", v);
      return [200, { request: v }, null];
    }
    if (method === "POST" && parts[0] === "requests" && parts[2] === "fetch" && parts.length === 3) {
      only(body, ["keyName"]);
      const r = requestOf(parts[1] as string);
      if (typeof body.keyName !== "string") throw refuse("AGENT_INVALID", { field: "keyName" });
      const item = r.items.find((i) => i.keyName === body.keyName);
      if (!item) throw refuse("AGENT_NOT_FOUND");
      settle(r);
      if (r.state === "closed") throw refuse("AGENT_NOT_APPROVED", { state: "closed" });
      if (item.state !== "approved") throw refuse("AGENT_NOT_APPROVED", { state: item.state });
      const s = circleOf(r.circleId).secrets.find((s) => s.keyName === item.keyName) as FakeSecret;
      const value =
        s.type === "login"
          ? { keyName: s.keyName, type: "login", username: s.username ?? null, password: s.value, url: s.url ?? null, version: 1 }
          : s.type === "totp"
            ? { keyName: s.keyName, type: "totp", code: s.value, expiresAt: new Date(Date.now() + 30_000).toISOString(), version: 1 }
            : { keyName: s.keyName, type: s.type, value: s.value, version: 1 };
      assertSchema("value", value);
      return [200, { value }, null];
    }
    throw refuse("AGENT_NOT_FOUND");
  }

  function approve(id: string, keyNames?: string[]): void {
    const r = requestOf(id);
    for (const it of r.items) {
      if (it.state === "pending" && (!keyNames || keyNames.includes(it.keyName))) {
        it.state = "approved";
        it.usableUntil = new Date(Date.now() + USE_MS);
      }
    }
    recompute(r);
  }

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url ?? "/", "http://x");
    const prefix = "/agent/v1/os";
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || "/" : null;
    const method = req.method ?? "GET";
    let status = 500;
    let payload: unknown;
    const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
    try {
      if (path === null) throw refuse("AGENT_NOT_FOUND");
      if (off) throw refuse("AGENT_API_OFF");
      const auth = req.headers.authorization;
      const id = req.headers["authoryx-agent"];
      if (id !== agentId || auth !== `Bearer ${agentKey}`) throw refuse("AGENT_UNAUTHORIZED");
      if (limited > 0) {
        limited--;
        headers["ratelimit-reset"] = String(limitReset);
        throw new Refusal(429, "RATE_LIMIT_EXCEEDED", "Too many calls from this agent. Try again in a minute.");
      }
      let body: Record<string, unknown> = {};
      if (method === "POST") {
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          throw refuse("AGENT_INVALID");
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) throw refuse("AGENT_INVALID");
      }
      const [s, data] = await handle(method, path, body);
      status = s;
      payload = { success: true, data };
    } catch (e) {
      const r = e instanceof Refusal ? e : new Refusal(503, "AGENT_UNAVAILABLE", "Could not complete this call. Try again.");
      if (!(e instanceof Refusal)) process.stderr.write(`fake-agent-api: ${(e as Error).stack}\n`);
      status = r.status;
      payload = { success: false, data: { error: r.message, code: r.code, ...r.extra } };
      assertSchema("error-envelope", payload);
    }
    calls.push({ method, path: url.pathname, status, userAgent: String(req.headers["user-agent"] ?? ""), headers: { ...req.headers }, body: raw });
    res.writeHead(status, headers);
    res.end(JSON.stringify(payload));
  }

  const server = createServer((req, res) => void onRequest(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    agentId,
    agentKey,
    calls,
    circles,
    approve,
    deny(id, keyNames) {
      const r = requestOf(id);
      for (const it of r.items) if (it.state === "pending" && (!keyNames || keyNames.includes(it.keyName))) it.state = "denied";
      recompute(r);
    },
    expire(id) {
      const r = requestOf(id);
      r.expiresAt = new Date(Date.now() - 1);
      settle(r);
    },
    expireUse(id) {
      const r = requestOf(id);
      for (const it of r.items) if (it.usableUntil) it.usableUntil = new Date(Date.now() - 1);
      settle(r);
    },
    setAutoApprove: (on) => void (autoApprove = on),
    setApiVersion: (v) => void (apiVersion = v),
    setOff: (o) => void (off = o),
    setCapabilities: (ids) => void (capabilities = ids),
    rateLimit(count, reset) {
      limited = count;
      limitReset = reset;
    },
    lastRequestId: () => lastId,
    requestState: (id) => {
      const r = requests.get(id);
      if (r) settle(r);
      return r?.state;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
