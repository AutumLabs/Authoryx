/**
 * Where the agent's id, key and API address come from (FR-007).
 *
 * 1. The environment: AUTHORYX_AGENT_ID and AUTHORYX_AGENT_KEY together, with
 *    AUTHORYX_API_URL. Nothing is stored.
 * 2. Otherwise the settings file (<config dir>/authoryx/config.json, mode 0600)
 *    holds the API address and the agent id, and the OS keychain holds the key
 *    under service `authoryx`, account `<agent id>`.
 *
 * The key never comes from an argument and is never written anywhere but the
 * keychain. The keychain is reached through the optional @napi-rs/keyring
 * module; without it, or on a system with no keychain, only the environment
 * works and `login` says so.
 */
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { EXIT, ToolError } from "./errors.js";

export const KEYCHAIN_SERVICE = "authoryx";
export const AGENT_ID_RE = /^agt_[a-z2-7]{26}$/;
export const AGENT_KEY_RE = /^axa_[0-9A-Za-z]{43}$/;

export interface KeyStore {
  /** False when there is no usable keychain on this system. */
  available(): boolean;
  get(agentId: string): string | null;
  set(agentId: string, key: string): void;
  /** True when an item was removed. */
  remove(agentId: string): boolean;
}

interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(p: string): void;
  deletePassword(): boolean;
}

/** The OS keychain, or an unavailable store when the optional module or the keychain is missing. */
export function keychain(): KeyStore {
  let Entry: (new (service: string, account: string) => KeyringEntry) | undefined;
  try {
    Entry = (createRequire(import.meta.url)("@napi-rs/keyring") as { Entry: typeof Entry }).Entry;
  } catch {
    Entry = undefined;
  }
  const entry = (id: string) => {
    if (!Entry) throw new ToolError("No keychain is available here.", "AUTHORYX_NO_KEYCHAIN", EXIT.unauthorized);
    return new Entry(KEYCHAIN_SERVICE, id);
  };
  return {
    available() {
      if (!Entry) return false;
      try {
        new Entry(KEYCHAIN_SERVICE, "authoryx-probe").getPassword();
        return true;
      } catch {
        return false;
      }
    },
    get(id) {
      try {
        const raw = entry(id).getPassword();
        if (!raw) return null;
        const key = (JSON.parse(raw) as { key?: unknown }).key;
        return typeof key === "string" ? key : null;
      } catch {
        return null;
      }
    },
    set(id, key) {
      entry(id).setPassword(JSON.stringify({ key }));
    },
    remove(id) {
      try {
        return entry(id).deletePassword();
      } catch {
        return false;
      }
    },
  };
}

/** A keychain in memory, for tests and for systems where the caller supplies one. */
export function memoryKeyStore(available = true): KeyStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    available: () => available,
    get: (id) => items.get(id) ?? null,
    set: (id, key) => void items.set(id, key),
    remove: (id) => items.delete(id),
  };
}

export function configDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (platform === "win32") return env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

export const settingsPath = (env: NodeJS.ProcessEnv = process.env) => join(configDir(env), "authoryx", "config.json");

export interface Settings {
  apiUrl: string;
  agentId: string;
}

export function readSettings(path: string): Settings | null {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<Settings>;
    return typeof s.apiUrl === "string" && typeof s.agentId === "string" ? { apiUrl: s.apiUrl, agentId: s.agentId } : null;
  } catch {
    return null;
  }
}

export function writeSettings(path: string, s: Settings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ apiUrl: s.apiUrl, agentId: s.agentId }, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows: ACLs, not modes */
  }
}

export const removeSettings = (path: string) => rmSync(path, { force: true });

export interface SignIn {
  agentId: string;
  agentKey: string;
  apiUrl: string;
  keySource: "keychain" | "environment";
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  store?: KeyStore;
  settingsFile?: string;
  /** --api, which wins over everything else. */
  apiUrl?: string;
}

export const NOT_SIGNED_IN =
  "No agent is signed in. Run `authoryx login`, or set AUTHORYX_AGENT_ID, AUTHORYX_AGENT_KEY and AUTHORYX_API_URL.";
export const NO_API =
  "No Authoryx API address is set. Pass --api <url> or set AUTHORYX_API_URL.";

export function resolveSignIn(opts: ResolveOptions = {}): SignIn {
  const env = opts.env ?? process.env;
  const id = env.AUTHORYX_AGENT_ID?.trim();
  const key = env.AUTHORYX_AGENT_KEY?.trim();
  if (id || key) {
    if (!id || !key) {
      throw new ToolError("Set both AUTHORYX_AGENT_ID and AUTHORYX_AGENT_KEY, or neither.", "AUTHORYX_USAGE", EXIT.usage);
    }
    const apiUrl = opts.apiUrl ?? env.AUTHORYX_API_URL?.trim() ?? readSettings(opts.settingsFile ?? settingsPath(env))?.apiUrl;
    if (!apiUrl) throw new ToolError(NO_API, "AUTHORYX_NO_API", EXIT.usage);
    return { agentId: id, agentKey: key, apiUrl, keySource: "environment" };
  }
  const settings = readSettings(opts.settingsFile ?? settingsPath(env));
  if (!settings) throw new ToolError(NOT_SIGNED_IN, "AUTHORYX_NOT_SIGNED_IN", EXIT.unauthorized);
  const stored = (opts.store ?? keychain()).get(settings.agentId);
  if (!stored) throw new ToolError(NOT_SIGNED_IN, "AUTHORYX_NOT_SIGNED_IN", EXIT.unauthorized);
  return {
    agentId: settings.agentId,
    agentKey: stored,
    apiUrl: opts.apiUrl ?? env.AUTHORYX_API_URL?.trim() ?? settings.apiUrl,
    keySource: "keychain",
  };
}
