/**
 * Open a session for a surface: resolve the sign-in, build the client with the
 * surface's user agent, and call whoami before anything else so an API version
 * this release does not support stops the tool at once (FR-017).
 */
import { Authoryx, type CallEvent } from "@authoryx/sdk";
import { resolveSignIn, type ResolveOptions } from "./credentials.js";
import { toToolError } from "./errors.js";
import type { Surface, ToolContext } from "./registry.js";
import { VERSION } from "./version.js";

export type Product = "cli" | "mcp";

export const userAgent = (product: Product) => `authoryx-${product}/${VERSION}`;

/**
 * Debug output (FR-011): one line per call with the method, route, status and
 * duration, to stderr. Built from the SDK's CallEvent, which carries no header,
 * body or key, so there is nothing to scrub.
 */
export function debugLogger(env: NodeJS.ProcessEnv = process.env, write: (s: string) => void = (s) => process.stderr.write(s)) {
  if (env.AUTHORYX_DEBUG !== "1" && env.AUTHORYX_DEBUG !== "true") return undefined;
  return (e: CallEvent) => write(`authoryx: ${e.method} ${e.route} ${e.status} ${e.durationMs}ms\n`);
}

export interface ConnectOptions extends ResolveOptions {
  surface: Surface;
  product: Product;
  pollMs?: number;
  fetch?: typeof globalThis.fetch;
  debug?: (s: string) => void;
}

export async function connect(opts: ConnectOptions): Promise<ToolContext> {
  const signIn = resolveSignIn(opts);
  const onCall = debugLogger(opts.env ?? process.env, opts.debug);
  const client = new Authoryx({
    agentId: signIn.agentId,
    agentKey: signIn.agentKey,
    apiUrl: signIn.apiUrl,
    userAgent: userAgent(opts.product),
    ...(onCall ? { onCall } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  try {
    const whoami = await client.whoami();
    return { client, whoami, apiUrl: client.apiUrl, keySource: signIn.keySource, surface: opts.surface, pollMs: opts.pollMs ?? 2000 };
  } catch (e) {
    throw toToolError(e, { apiUrl: client.apiUrl });
  }
}
