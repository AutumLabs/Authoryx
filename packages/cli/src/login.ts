/**
 * Sign in and out (FR-007). The key is read from a prompt that does not echo,
 * or from standard input, never from an argument. A refused sign-in stores
 * nothing. One keychain item per agent id; the settings file holds the API
 * address and the agent id, never the key.
 */
import {
  AGENT_ID_RE,
  AGENT_KEY_RE,
  EXIT,
  ToolError,
  keychain,
  readSettings,
  removeSettings,
  resolveSignIn,
  settingsPath,
  toToolError,
  usage,
  userAgent,
  writeSettings,
  type KeyStore,
} from "@authoryx/core";
import { Authoryx } from "@authoryx/sdk";
import { firstLine, terminalPrompt, type Io } from "./io.js";

export const KEY_AS_ARGUMENT =
  "Never pass the agent key as an argument: shell history keeps it and other programs can read it. Paste it at the prompt, or pipe it on standard input.";

export const NO_KEYCHAIN =
  "This system has no keychain the tools can use, so nothing can be stored. Set AUTHORYX_AGENT_ID, AUTHORYX_AGENT_KEY and AUTHORYX_API_URL in the environment instead.";

/** Refuse anything on the command line that looks like a key or a key flag. */
export function refuseKeyArgument(argv: readonly string[]): void {
  if (argv.some((a) => /^--key(=|$)/.test(a) || /axa_[0-9A-Za-z]{20,}/.test(a))) throw usage(KEY_AS_ARGUMENT);
}

export interface LoginInput {
  api?: string | undefined;
  agent?: string | undefined;
  json?: boolean;
}

export async function login(io: Io, input: LoginInput): Promise<{ agent: { id: string; name: string; hostKind: string }; apiUrl: string }> {
  const store: KeyStore = io.store ?? keychain();
  const file = io.settingsFile ?? settingsPath(io.env);
  if (!store.available()) throw new ToolError(NO_KEYCHAIN, "AUTHORYX_NO_KEYCHAIN", EXIT.unauthorized);
  const prompt = io.prompt ?? terminalPrompt(io);
  const interactive = !!io.stdin.isTTY;

  const apiUrl = (input.api ?? io.env.AUTHORYX_API_URL ?? readSettings(file)?.apiUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/.test(apiUrl)) throw usage("Give the Authoryx API's address: authoryx login --api https://…");

  let agentId = (input.agent ?? "").trim();
  if (!agentId) {
    if (!interactive) throw usage("Give the agent id with --agent agt_… when the key comes from standard input.");
    agentId = await prompt("Agent id (agt_…): ", false);
  }
  if (!AGENT_ID_RE.test(agentId)) throw usage("That is not an agent id; it looks like agt_ followed by 26 letters and digits.");

  const key = interactive ? await prompt("Agent key (axa_…, hidden): ", true) : await firstLine(io.stdin);
  if (!AGENT_KEY_RE.test(key)) throw usage("That is not an agent key; it looks like axa_ followed by 43 letters and digits.");

  const client = new Authoryx({ agentId, agentKey: key, apiUrl, userAgent: userAgent("cli"), maxRetryWaitSeconds: 0 });
  let me;
  try {
    me = await client.whoami();
  } catch (e) {
    throw toToolError(e, { apiUrl });
  }
  store.set(agentId, key);
  writeSettings(file, { apiUrl, agentId });
  return { agent: me.agent, apiUrl };
}

export function logout(io: Io): { removed: boolean; agentId: string | null; environment: boolean } {
  const store: KeyStore = io.store ?? keychain();
  const file = io.settingsFile ?? settingsPath(io.env);
  const settings = readSettings(file);
  const environment = !!(io.env.AUTHORYX_AGENT_ID || io.env.AUTHORYX_AGENT_KEY);
  const removed = settings ? store.remove(settings.agentId) : false;
  removeSettings(file);
  return { removed, agentId: settings?.agentId ?? null, environment };
}

/** What `doctor` reports: each line a check and its result, never a key. */
export async function doctor(io: Io, api?: string): Promise<{ checks: { name: string; ok: boolean; detail: string }[] }> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: `Node ${process.versions.node}${major >= 20 ? "" : "; Node 20 or newer is needed"}` });
  const store = io.store ?? keychain();
  checks.push({ name: "keychain", ok: store.available(), detail: store.available() ? "available" : "not available; use the AUTHORYX_* environment variables" });
  try {
    const s = resolveSignIn({ env: io.env, store, settingsFile: io.settingsFile ?? settingsPath(io.env), ...(api ? { apiUrl: api } : {}) });
    checks.push({ name: "sign-in", ok: true, detail: `${s.agentId} from the ${s.keySource}, API ${s.apiUrl}` });
    try {
      const me = await new Authoryx({ ...s, userAgent: userAgent("cli"), maxRetryWaitSeconds: 0 }).whoami();
      checks.push({ name: "api", ok: true, detail: `signed in as ${me.agent.name}, API version ${me.apiVersion}` });
    } catch (e) {
      checks.push({ name: "api", ok: false, detail: toToolError(e, { apiUrl: s.apiUrl }).message });
    }
  } catch (e) {
    checks.push({ name: "sign-in", ok: false, detail: (e as Error).message });
  }
  return { checks };
}
