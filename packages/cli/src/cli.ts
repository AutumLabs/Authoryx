/**
 * The `authoryx` command-line tool (FR-008, FR-009). Each verb is a registered
 * tool from @authoryx/core; this file only parses arguments, prints results and
 * picks the exit status. `run` passes the program's own exit status through.
 */
import {
  EXIT,
  ToolError,
  VERSION,
  callTool,
  connect,
  defaultRegistry,
  settingsPath,
  toToolError,
  usage,
  type RequestView,
  type RunResult,
  type ToolContext,
} from "@authoryx/core";
import type { Value } from "@authoryx/sdk";
import { parse, type Spec } from "./args.js";
import * as fmt from "./format.js";
import { NOT_A_SANDBOX, hookSnippet, installGuard, settingsFile } from "./hooks.js";
import type { Io } from "./io.js";
import { doctor, login, logout, refuseKeyArgument } from "./login.js";

const registry = defaultRegistry();

const SPECS: Record<string, Spec> = {
  login: { values: ["agent"] },
  logout: {},
  whoami: {},
  doctor: {},
  circles: {},
  secrets: {},
  request: { values: ["reason", "hint"], optional: ["wait"] },
  status: { optional: ["wait"] },
  run: { values: ["request", "circle", "reason", "timeout"], repeat: ["key"] },
  fetch: { values: ["request", "circle", "reason", "field"], bools: ["show"] },
  close: { values: ["outcome"] },
  hooks: { values: ["host"], bools: ["project"] },
};

const USAGE: Record<string, string> = {
  login: "login [--api <url>] [--agent <agt_…>]",
  logout: "logout",
  doctor: "doctor",
  whoami: "whoami",
  circles: "circles",
  secrets: "secrets <circle>",
  request: "request <circle> <KEY…> --reason <text> [--hint once|1h|always] [--wait [seconds]]",
  status: "status <requestId> [--wait [seconds]]",
  run: "run [--request <id> | --circle <circle> --reason <text>] --key <KEY>… [--timeout <s>] -- <program> [args…]",
  fetch: "fetch <KEY> (--request <id> | --circle <circle> --reason <text>) [--field username|password|url] [--show]",
  close: "close <requestId> [--outcome done|abandoned|failed]",
  hooks: "hooks install [--host claude-code] [--project] | hooks print",
};

export function help(): string {
  const lines = [`authoryx ${VERSION}: ask to use a secret, wait for its owner's answer, run a program with it.`, "", "Commands:"];
  lines.push(`  ${USAGE.login}`, "      Sign an agent in; the key is read from a hidden prompt or standard input and kept in the OS keychain.");
  lines.push(`  ${USAGE.logout}`, "      Remove the agent's keychain item and settings.");
  lines.push(`  ${USAGE.doctor}`, "      Check Node, the keychain, the sign-in and the API.");
  for (const t of registry.toolsFor("cli", {})) lines.push(`  ${USAGE[t.cli]}`, `      ${t.summary}`);
  lines.push(`  ${USAGE.hooks}`, "      Add the Authoryx guard to Claude Code's settings.");
  lines.push("", "Options: --json for one JSON document, --debug to log each call, --api <url> for the API address.", "");
  return lines.join("\n");
}

const viewExit = (v: RequestView) =>
  v.state === "approved" || v.state === "closed" ? EXIT.ok : v.state === "denied" ? EXIT.denied : v.state === "expired" ? EXIT.expired : EXIT.notApproved;

const isView = (x: unknown): x is RequestView => typeof x === "object" && x !== null && "requestId" in x && "next" in x && !("ran" in x);

function waitSeconds(flag: string | true | undefined): number | null {
  if (flag === undefined) return null;
  if (flag === true) return 300;
  const n = Number(flag);
  if (!Number.isInteger(n) || n < 0 || n > 3600) throw usage("--wait takes a number of seconds.");
  return n;
}

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const json = argv.includes("--json");
  const out = (s: string) => io.stdout.write(s);
  const say = (data: unknown, text: string) => out(json ? JSON.stringify(data, null, 2) + "\n" : text);
  try {
    if (!argv.length || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
      out(help());
      return EXIT.ok;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      out(`authoryx ${VERSION}\n`);
      return EXIT.ok;
    }
    const verb = argv[0] as string;
    const spec = SPECS[verb];
    if (!spec) throw usage(`Unknown command ${verb}. Run authoryx --help.`);
    if (verb === "login") refuseKeyArgument(argv);
    const p = parse(argv.slice(1), spec);
    if (p.flags.help) {
      out(`authoryx ${USAGE[verb]}\n`);
      return EXIT.ok;
    }
    const env = p.flags.debug ? { ...io.env, AUTHORYX_DEBUG: "1" } : io.env;
    const api = typeof p.flags.api === "string" ? p.flags.api : undefined;
    const settingsFileOf = io.settingsFile ?? settingsPath(io.env);

    switch (verb) {
      case "login": {
        const r = await login({ ...io, env }, { api, agent: p.flags.agent as string | undefined });
        say(r, `Signed in as ${r.agent.name} (${r.agent.id}) on ${r.apiUrl}. The key is in the OS keychain.\n`);
        return EXIT.ok;
      }
      case "logout": {
        const r = logout(io);
        const text = r.removed
          ? `Signed out ${r.agentId}: its keychain item is removed.\n`
          : r.agentId
            ? `Signed out ${r.agentId}; there was no keychain item to remove.\n`
            : "No agent was signed in.\n";
        say(r, text + (r.environment ? "AUTHORYX_AGENT_ID and AUTHORYX_AGENT_KEY are still set in this environment.\n" : ""));
        return EXIT.ok;
      }
      case "doctor": {
        const r = await doctor({ ...io, env }, api);
        say(r, r.checks.map((c) => `${c.ok ? "ok  " : "FAIL"}  ${c.name}: ${c.detail}`).join("\n") + "\n");
        return r.checks.every((c) => c.ok) ? EXIT.ok : EXIT.failure;
      }
      case "hooks": {
        const sub = p.positional[0];
        if (sub === "print") {
          out(JSON.stringify(hookSnippet(), null, 2) + "\n");
          return EXIT.ok;
        }
        if (sub !== "install") throw usage(`authoryx ${USAGE.hooks}`);
        if (p.flags.host && p.flags.host !== "claude-code") throw usage("Only --host claude-code has a guard hook today.");
        const file = settingsFile({ project: !!p.flags.project, ...(io.cwd ? { cwd: io.cwd } : {}), ...(io.home ? { home: io.home } : {}) });
        const added = installGuard(file);
        say({ file, added }, `${added ? "Added" : "Kept"} the Authoryx guard in ${file}.\n${NOT_A_SANDBOX}\n`);
        return EXIT.ok;
      }
    }

    const ctx: ToolContext = await connect({
      surface: "cli",
      product: "cli",
      env,
      ...(io.store ? { store: io.store } : {}),
      settingsFile: settingsFileOf,
      ...(api ? { apiUrl: api } : {}),
      ...(io.pollMs ? { pollMs: io.pollMs } : {}),
    });
    const tool = registry.find("cli", ctx.whoami, verb);
    if (!tool) throw usage(`Unknown command ${verb}. Run authoryx --help.`);
    const call = (input: unknown) => callTool(tool, ctx, input);

    switch (verb) {
      case "whoami": {
        const r = (await call({})) as { agent: { id: string; name: string; hostKind: string }; api: { url: string; version: number }; keySource: string };
        say(r, `${r.agent.name} (${r.agent.id}), ${r.agent.hostKind}\nAPI ${r.api.url}, version ${r.api.version}\nKey from the ${r.keySource}\n`);
        return EXIT.ok;
      }
      case "circles": {
        const r = (await call({})) as { circles: Parameters<typeof fmt.circles>[0] };
        say(r, fmt.circles(r.circles));
        return EXIT.ok;
      }
      case "secrets": {
        if (!p.positional[0]) throw usage(`authoryx ${USAGE.secrets}`);
        const r = (await call({ circle: p.positional[0] })) as Parameters<typeof fmt.secrets>[0];
        say(r, fmt.secrets(r));
        return EXIT.ok;
      }
      case "request": {
        const [circle, ...keys] = p.positional;
        if (!circle || !keys.length) throw usage(`authoryx ${USAGE.request}`);
        let v = (await call({ circle, keys, reason: p.flags.reason, ...(p.flags.hint ? { hint: p.flags.hint } : {}) })) as RequestView;
        const wait = waitSeconds(p.flags.wait);
        if (wait !== null && v.state === "pending") {
          if (!json) out(fmt.request(v));
          v = await waitFor(ctx, v, wait);
          say(v, v.state === "pending" ? `Still waiting after ${wait} seconds.\n` : fmt.request(v));
        } else say(v, fmt.request(v));
        return wait !== null || v.state !== "pending" ? viewExit(v) : EXIT.ok;
      }
      case "status": {
        const id = p.positional[0];
        if (!id) throw usage(`authoryx ${USAGE.status}`);
        let v = (await callTool(registry.find("cli", ctx.whoami, "status")!, ctx, { requestId: id })) as RequestView;
        const wait = waitSeconds(p.flags.wait);
        if (wait !== null && v.state === "pending") {
          if (!json) out(fmt.request(v));
          v = await waitFor(ctx, v, wait);
        }
        say(v, fmt.request(v));
        return viewExit(v);
      }
      case "close": {
        const id = p.positional[0];
        if (!id) throw usage(`authoryx ${USAGE.close}`);
        const v = (await call({ requestId: id, outcome: p.flags.outcome ?? "done" })) as RequestView;
        say(v, fmt.request(v));
        return EXIT.ok;
      }
      case "run": {
        if (!p.rest.length) throw usage(`authoryx ${USAGE.run}`);
        const timeout = p.flags.timeout === undefined ? undefined : Number(p.flags.timeout);
        const r = (await call({
          command: p.rest,
          keys: p.lists.key ?? [],
          ...(p.flags.request ? { requestId: p.flags.request } : {}),
          ...(p.flags.circle ? { circle: p.flags.circle, reason: p.flags.reason } : {}),
          ...(timeout !== undefined ? { timeoutSeconds: timeout } : {}),
          ...(io.cwd ? { cwd: io.cwd } : {}),
        })) as RunResult | RequestView;
        if (isView(r)) {
          say(r, fmt.request(r));
          return viewExit(r) === EXIT.ok ? EXIT.notApproved : viewExit(r);
        }
        if (json) out(JSON.stringify(r, null, 2) + "\n");
        else {
          out(r.output);
          const notes = [`${r.redactions} value${r.redactions === 1 ? "" : "s"} removed from the output.`, r.note].filter(Boolean).join(" ");
          if (r.redactions || r.note) io.stderr.write(`authoryx: ${notes}\n`);
        }
        return r.timedOut ? EXIT.failure : r.exitCode ?? EXIT.failure;
      }
      case "fetch": {
        const key = p.positional[0];
        if (!key) throw usage(`authoryx ${USAGE.fetch}`);
        if (io.stdout.isTTY && !p.flags.show) {
          throw usage(
            `authoryx fetch prints no value to a terminal. Pipe it to the program that needs it (authoryx fetch ${key} … | program), use authoryx run, or add --show if you mean to see it.`,
          );
        }
        const field = p.flags.field as string | undefined;
        if (field && !["username", "password", "url"].includes(field)) throw usage("--field is username, password or url.");
        const r = (await call({
          key,
          ...(p.flags.request ? { requestId: p.flags.request } : {}),
          ...(p.flags.circle ? { circle: p.flags.circle, reason: p.flags.reason } : {}),
        })) as { value: Value } | RequestView;
        if (isView(r)) {
          io.stderr.write(fmt.request(r));
          return viewExit(r) === EXIT.ok ? EXIT.notApproved : viewExit(r);
        }
        out(`${pick(r.value, field)}\n`);
        return EXIT.ok;
      }
    }
    throw usage(`Unknown command ${verb}.`);
  } catch (e) {
    const t = e instanceof ToolError ? e : toToolError(e);
    if (json) io.stdout.write(JSON.stringify({ error: t.toJSON() }, null, 2) + "\n");
    else io.stderr.write(`authoryx: ${t.message}\n`);
    return t.exit;
  }
}

function pick(v: Value, field: string | undefined): string {
  if (v.type === "login") {
    const f = field ?? "password";
    const x = f === "username" ? v.username : f === "url" ? v.url : v.password;
    if (x === null) throw usage(`${v.keyName} has no ${f}.`);
    return x;
  }
  if (field) throw usage(`--field is for logins; ${v.keyName} is ${v.type === "totp" ? "a one-time code" : "one value"}.`);
  return v.type === "totp" ? v.code : v.value;
}

async function waitFor(ctx: ToolContext, v: RequestView, seconds: number): Promise<RequestView> {
  const tool = registry.find("cli", ctx.whoami, "status")!;
  const deadline = Date.now() + seconds * 1000;
  let cur = v;
  while (cur.state === "pending" && Date.now() < deadline) {
    const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
    cur = (await callTool(tool, ctx, { requestId: v.requestId, wait: chunk })) as RequestView;
  }
  return cur;
}
