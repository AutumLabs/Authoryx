/**
 * The verbs, each defined once as a registered tool (FR-002–FR-006, FR-009).
 * The MCP server, the command-line tool and the generated docs all read these
 * definitions; a summary written here is the only copy of that sentence.
 */
import { AuthoryxError, type Circle, type Hint, type Outcome, type Value } from "@authoryx/sdk";
import { EXIT, ToolError, toToolError, usage } from "../errors.js";
import { Registry, type ToolContext, type ToolDef } from "../registry.js";
import { runProgram, SpawnError, type RunResult } from "../run.js";
import { toView, type RequestView } from "../view.js";

const KEY_NAME = /^[A-Z][A-Z0-9_]*$/;
const MAX_KEYS = 10;
const MAX_REASON = 500;

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw usage(`${name} is required.`);
  return v.trim();
}

function keyList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw usage("Name at least one key, e.g. API_TOKEN.");
  if (v.length > MAX_KEYS) throw usage(`Name at most ${MAX_KEYS} keys in one request.`);
  const keys = v.map((k) => (typeof k === "string" ? k.trim() : ""));
  const bad = keys.filter((k) => !KEY_NAME.test(k));
  if (bad.length) throw usage(`Not a key name: ${bad.join(", ")}. Key names look like API_TOKEN.`);
  return [...new Set(keys)];
}

function reasonOf(v: unknown): string {
  const r = typeof v === "string" ? v.trim() : "";
  if (!r) throw usage("Give a reason: the owner reads it before deciding.");
  if (r.length > MAX_REASON) throw usage(`Keep the reason under ${MAX_REASON} characters.`);
  return r;
}

const HINTS: readonly Hint[] = ["once", "1h", "always"];
const OUTCOMES: readonly Outcome[] = ["done", "abandoned", "failed"];

/** A circle by id, or by name when exactly one attached circle has it. */
export async function resolveCircle(ctx: ToolContext, ref: string): Promise<Circle> {
  const circles = await ctx.client.circles();
  const byId = circles.find((c) => c.id === ref);
  if (byId) return byId;
  const byName = circles.filter((c) => c.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0] as Circle;
  if (byName.length > 1) {
    throw usage(`More than one circle is named "${ref}": ${byName.map((c) => `${c.name} (${c.id})`).join(", ")}. Use the id.`, {
      matches: byName.map((c) => ({ id: c.id, name: c.name })),
    });
  }
  throw new ToolError(`Circle "${ref}": Not found. It does not exist, or this agent cannot reach it.`, "AGENT_NOT_FOUND", EXIT.notFound);
}

/** The ids of this agent's requests waiting for an answer, read from every circle's shares. */
async function pendingIds(ctx: ToolContext): Promise<string[]> {
  const ids = new Set<string>();
  for (const c of await ctx.client.circles()) {
    const { secrets } = await ctx.client.secrets(c.id);
    for (const s of secrets) if (s.access.state === "ask" && s.access.pendingRequestId) ids.add(s.access.pendingRequestId);
  }
  return [...ids];
}

async function openRequest(ctx: ToolContext, input: { circle: unknown; keys: unknown; reason: unknown; hint?: unknown }) {
  const keys = keyList(input.keys);
  const reason = reasonOf(input.reason);
  if (input.hint !== undefined && !HINTS.includes(input.hint as Hint)) throw usage("hint is once, 1h or always.");
  const circle = await resolveCircle(ctx, str(input.circle, "circle"));
  try {
    return await ctx.client.request({ circleId: circle.id, keyNames: keys, reason, ...(input.hint ? { hint: input.hint as Hint } : {}) });
  } catch (e) {
    if (e instanceof AuthoryxError && e.kind === "pending_limit") {
      const ids = await pendingIds(ctx).catch(() => [] as string[]);
      const t = toToolError(e);
      throw new ToolError(`${t.message}${ids.length ? ` Waiting: ${ids.join(", ")}.` : ""}`, t.code, t.exit, { pendingRequestIds: ids });
    }
    throw e;
  }
}

const CIRCLE = { type: "string", description: "The circle's id, or its name when only one of your circles has it." };
const KEYS = { type: "array", items: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" }, minItems: 1, maxItems: MAX_KEYS, description: "Key names, e.g. API_TOKEN." };
const REASON = { type: "string", minLength: 1, maxLength: MAX_REASON, description: "Why the work needs these secrets, in a sentence the owner reads." };
const REQUEST_ID = { type: "string", description: "The request's id." };

export const whoamiTool: ToolDef<Record<string, never>, unknown> = {
  name: "authoryx_whoami",
  cli: "whoami",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "Show which agent is signed in, the Authoryx API it talks to, and where its key comes from.",
  returns: "agent id, name, host kind, API address and version, key source",
  never: "the key",
  input: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    return { agent: ctx.whoami.agent, api: { url: ctx.apiUrl, version: ctx.whoami.apiVersion }, keySource: ctx.keySource };
  },
};

export const listCirclesTool: ToolDef<Record<string, never>, { circles: Circle[] }> = {
  name: "authoryx_list_circles",
  cli: "circles",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "List the circles this agent is attached to.",
  returns: "each circle's id, name and description",
  never: "members",
  input: { type: "object", properties: {}, additionalProperties: false },
  async run(ctx) {
    return { circles: await ctx.client.circles() };
  },
};

export const listSecretsTool: ToolDef<{ circle: string }, unknown> = {
  name: "authoryx_list_secrets",
  cli: "secrets",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "List what is shared into one circle, with each secret's key name, type and whether this agent may use it now.",
  returns: "key names, names, types, vaults and access state",
  never: "values",
  input: { type: "object", properties: { circle: CIRCLE }, required: ["circle"], additionalProperties: false },
  async run(ctx, input) {
    const circle = await resolveCircle(ctx, str(input?.circle, "circle"));
    const { secrets, vaults } = await ctx.client.secrets(circle.id);
    return { circle: { id: circle.id, name: circle.name }, secrets, vaults };
  },
};

export const requestAccessTool: ToolDef<{ circle: string; keys: string[]; reason: string; hint?: Hint }, RequestView> = {
  name: "authoryx_request_access",
  cli: "request",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "Ask to use secrets from a circle, with a reason. The owner approves or denies on the Authoryx dashboard; while they decide, show your person the approval link.",
  returns: "approved, or pending with who is awaited and the approval link",
  never: "values",
  input: {
    type: "object",
    properties: { circle: CIRCLE, keys: KEYS, reason: REASON, hint: { type: "string", enum: HINTS, description: "How long you expect to need them; the owner decides." } },
    required: ["circle", "keys", "reason"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    return toView(await openRequest(ctx, input ?? {}));
  },
};

export const checkRequestTool: ToolDef<{ requestId: string; wait?: number }, RequestView> = {
  name: "authoryx_check_request",
  cli: "status",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "Read a request's state, waiting up to 60 seconds for the owner's answer.",
  returns: "the request's state, per key",
  never: "values",
  input: {
    type: "object",
    properties: { requestId: REQUEST_ID, wait: { type: "integer", minimum: 0, maximum: 60, description: "Seconds to wait for an answer; 0 reads once." } },
    required: ["requestId"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const id = str(input?.requestId, "requestId");
    const wait = input?.wait ?? 0;
    if (typeof wait !== "number" || !Number.isFinite(wait) || wait < 0 || wait > 60) throw usage("wait is 0 to 60 seconds.");
    const r = wait > 0 ? await ctx.client.waitForRequest(id, { seconds: wait, intervalMs: ctx.pollMs }) : await ctx.client.getRequest(id);
    return toView(r);
  },
};

export const closeRequestTool: ToolDef<{ requestId: string; outcome?: Outcome }, RequestView> = {
  name: "authoryx_close_request",
  cli: "close",
  capability: "ask",
  tier: "none",
  surfaces: ["mcp", "cli"],
  summary: "Close a request when the work is done, so its secrets can no longer be used.",
  returns: "the closed request",
  never: "values",
  input: {
    type: "object",
    properties: { requestId: REQUEST_ID, outcome: { type: "string", enum: OUTCOMES, description: "How the work ended; done by default." } },
    required: ["requestId"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const outcome = input?.outcome ?? "done";
    if (!OUTCOMES.includes(outcome)) throw usage("outcome is done, abandoned or failed.");
    return toView(await ctx.client.closeRequest(str(input?.requestId, "requestId"), outcome));
  },
};

/** Open or read the request, and say which keys cannot be used now; null when all can. */
async function approvedRequest(ctx: ToolContext, input: { requestId?: unknown; circle?: unknown; reason?: unknown }, keys: string[]) {
  const r =
    typeof input.requestId === "string" && input.requestId.trim()
      ? await ctx.client.getRequest(input.requestId.trim())
      : input.circle !== undefined
        ? await openRequest(ctx, { circle: input.circle, keys, reason: input.reason })
        : (() => {
            throw usage("Give a requestId, or a circle and a reason to open one.");
          })();
  const missing = keys.filter((k) => !r.items.some((i) => i.keyName === k));
  if (missing.length) throw usage(`Not in request ${r.id}: ${missing.join(", ")}. Open a request that names them.`);
  const now = Date.now();
  const blocked = r.state !== "approved" || r.items.some((i) => keys.includes(i.keyName) && (i.state !== "approved" || (i.usableUntil !== null && Date.parse(i.usableUntil) <= now)));
  return { request: r, blocked };
}

export const runTool: ToolDef<
  { command: string[]; keys: string[]; requestId?: string; circle?: string; reason?: string; timeoutSeconds?: number; cwd?: string },
  RunResult | RequestView
> = {
  name: "authoryx_run",
  cli: "run",
  capability: "run",
  tier: "t1",
  surfaces: ["mcp", "cli"],
  summary: "Run a program with approved secrets in its environment, each as a variable named by its key. You get the exit code and the output with every value removed.",
  returns: "exit code and redacted output",
  never: "the secret",
  input: {
    type: "object",
    properties: {
      command: { type: "array", items: { type: "string" }, minItems: 1, description: "The program and its arguments; run directly, not through a shell." },
      keys: KEYS,
      requestId: { ...REQUEST_ID, description: "An approved request naming these keys." },
      circle: { ...CIRCLE, description: "With reason, opens a request when there is no requestId." },
      reason: REASON,
      timeoutSeconds: { type: "integer", minimum: 1, maximum: 600, default: 120 },
      cwd: { type: "string", description: "Working directory for the program." },
    },
    required: ["command", "keys"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const command = input?.command;
    if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === "string") || !command[0]) {
      throw usage("command is the program and its arguments, e.g. [\"npm\", \"run\", \"deploy\"].");
    }
    const keys = keyList(input.keys);
    const t = input.timeoutSeconds ?? 120;
    if (!Number.isInteger(t) || t < 1 || t > 600) throw usage("timeoutSeconds is 1 to 600.");
    const { request, blocked } = await approvedRequest(ctx, input, keys);
    if (blocked) return toView(request);
    const values: Value[] = [];
    for (const k of keys) {
      try {
        values.push(await ctx.client.fetch(request.id, k));
      } catch (e) {
        throw toToolError(e, { keyName: k });
      }
    }
    try {
      return await runProgram({ command, values, requestId: request.id, timeoutSeconds: t, ...(input.cwd ? { cwd: input.cwd } : {}) });
    } catch (e) {
      if (e instanceof SpawnError) throw new ToolError(e.message, "AUTHORYX_SPAWN", EXIT.failure);
      throw e;
    } finally {
      values.length = 0;
    }
  },
};

export const fetchTool: ToolDef<{ key: string; requestId?: string; circle?: string; reason?: string }, { value: Value } | RequestView> = {
  name: "authoryx_fetch",
  cli: "fetch",
  capability: "fetch",
  tier: "t1",
  surfaces: ["cli"],
  summary: "Write one approved value to a pipe for a script. Command line only; never offered to an agent through MCP.",
  returns: "the value, to a pipe",
  never: "— (never an MCP tool)",
  input: {
    type: "object",
    properties: { key: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" }, requestId: REQUEST_ID, circle: CIRCLE, reason: REASON },
    required: ["key"],
    additionalProperties: false,
  },
  async run(ctx, input) {
    const [key] = keyList([input?.key]);
    const { request, blocked } = await approvedRequest(ctx, input ?? {}, [key as string]);
    if (blocked) return toView(request);
    try {
      return { value: await ctx.client.fetch(request.id, key as string) };
    } catch (e) {
      throw toToolError(e, { keyName: key as string });
    }
  },
};

/** Every tool this release ships, in the order docs list them. No T2 tool is registered (FR-016). */
export function defaultRegistry(): Registry {
  return new Registry()
    .add(whoamiTool)
    .add(listCirclesTool)
    .add(listSecretsTool)
    .add(requestAccessTool)
    .add(checkRequestTool)
    .add(runTool)
    .add(closeRequestTool)
    .add(fetchTool);
}

/** Run a tool, turning every failure into a ToolError with the contract's sentence. */
export async function callTool(tool: ToolDef, ctx: ToolContext, input: unknown): Promise<unknown> {
  try {
    return await tool.run(ctx, input ?? {});
  } catch (e) {
    throw toToolError(e, { apiUrl: ctx.apiUrl });
  }
}
