/**
 * The tool registry (ADR-0020). Every tool any surface offers is defined once
 * here, with the tier that says how far a value travels from the agent and the
 * capability that must be granted for the tool to be offered.
 *
 * A surface lists `toolsFor(surface, whoami)` and nothing else. The granted set
 * is always `ask`, `run` and `fetch`, plus the known ids the platform lists in
 * `whoami.capabilities`; an id this release does not know is ignored, so the
 * platform can grant a T2 capability before the tools that use it exist.
 */
import type { Authoryx, WhoAmI } from "@authoryx/sdk";

/** none: no value moves. t1: the value reaches a program on the agent's machine. t2: an Authoryx tool uses it for the agent. */
export type Tier = "none" | "t1" | "t2";
export type Surface = "mcp" | "cli";

export interface Capability {
  id: string;
  name: string;
  tier: Tier;
  summary: string;
  /** true: named and reserved; no tool ships for it yet. */
  reserved: boolean;
}

/** Every capability id the tools know, in the order docs list them. */
export const CAPABILITIES: readonly Capability[] = [
  { id: "ask", name: "Ask", tier: "none", reserved: false, summary: "See circles and what is shared in them, ask to use secrets, follow and close requests." },
  { id: "run", name: "Run with secrets", tier: "t1", reserved: false, summary: "Run a program with approved secrets in its environment; the agent gets the exit code and the output with each value removed." },
  { id: "fetch", name: "Fetch for scripts", tier: "t1", reserved: false, summary: "Hand an approved value to a script through a pipe or an SDK; command line and SDK only, never MCP." },
  { id: "web.signin", name: "Web sign-in", tier: "t2", reserved: true, summary: "A tool signs in to a website with an approved login for the agent." },
  { id: "web.signup", name: "New account", tier: "t2", reserved: true, summary: "A tool creates an account on a website and keeps its login as a new secret." },
  { id: "http.call", name: "API call", tier: "t2", reserved: true, summary: "A tool calls an HTTP API with an approved key and returns the response with the key removed." },
  { id: "secret.create", name: "New secret", tier: "t2", reserved: true, summary: "A tool creates a secret from a value the agent's program generates, without the agent holding it." },
  { id: "export", name: "Export to a service", tier: "t2", reserved: true, summary: "A tool writes an approved secret into another service's secret store." },
  { id: "connector.<service>", name: "Connector", tier: "t2", reserved: true, summary: "A fixed-purpose tool for one service that uses an approved secret for the agent." },
];

export const ALWAYS: readonly string[] = ["ask", "run", "fetch"];

/** True for an id in CAPABILITIES, including `connector.<service>` for any service name. */
export function isKnownCapability(id: string): boolean {
  if (/^connector\.[a-z0-9][a-z0-9-]*$/.test(id)) return true;
  return CAPABILITIES.some((c) => c.id === id && !c.id.includes("<"));
}

export function granted(whoami: Pick<WhoAmI, "capabilities">): Set<string> {
  const out = new Set(ALWAYS);
  for (const id of whoami.capabilities ?? []) if (typeof id === "string" && isKnownCapability(id)) out.add(id);
  return out;
}

export type JSONSchema = Record<string, unknown>;

export interface ToolContext {
  client: Authoryx;
  whoami: WhoAmI;
  apiUrl: string;
  keySource: "keychain" | "environment";
  surface: Surface;
  /** How often waits read a request; 2000 ms in use, shorter in tests. */
  pollMs: number;
}

export interface ToolDef<I = unknown, O = unknown> {
  /** The MCP tool name; the command-line verb is `cli`. */
  name: string;
  cli: string;
  capability: string;
  tier: Tier;
  surfaces: readonly Surface[];
  /** One or two sentences: the MCP description, the command-line help line and the README row. */
  summary: string;
  /** What the result carries. */
  returns: string;
  /** What the result never carries. */
  never: string;
  input: JSONSchema;
  run(ctx: ToolContext, input: I): Promise<O>;
}

export class Registry {
  readonly #tools: ToolDef[] = [];

  add(tool: ToolDef): this {
    if (!["none", "t1", "t2"].includes(tool.tier)) throw new Error(`${tool.name}: tier must be none, t1 or t2`);
    const cap = CAPABILITIES.find((c) => c.id === tool.capability) ?? (isKnownCapability(tool.capability) ? { tier: "t2" as Tier } : undefined);
    if (!cap) throw new Error(`${tool.name}: capability ${tool.capability} is not in protocol/capabilities.md`);
    if (cap.tier !== tool.tier) throw new Error(`${tool.name}: tier ${tool.tier} does not match capability ${tool.capability} (${cap.tier})`);
    if (tool.capability === "fetch" && tool.surfaces.includes("mcp")) throw new Error(`${tool.name}: fetch is never an MCP tool`);
    if (this.#tools.some((t) => t.name === tool.name || t.cli === tool.cli)) throw new Error(`${tool.name}: registered twice`);
    this.#tools.push(tool);
    return this;
  }

  all(): readonly ToolDef[] {
    return this.#tools;
  }

  /** The tools this surface offers this agent: registry ∩ surface ∩ granted. */
  toolsFor(surface: Surface, whoami: Pick<WhoAmI, "capabilities">): ToolDef[] {
    const g = granted(whoami);
    return this.#tools.filter((t) => t.surfaces.includes(surface) && g.has(t.capability));
  }

  /** A tool by name, only if offered; otherwise undefined, so the caller answers "unknown tool". */
  find(surface: Surface, whoami: Pick<WhoAmI, "capabilities">, name: string): ToolDef | undefined {
    return this.toolsFor(surface, whoami).find((t) => t.name === name || (surface === "cli" && t.cli === name));
  }
}
