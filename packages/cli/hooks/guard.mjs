#!/usr/bin/env node
/**
 * The Authoryx guard for Claude Code (PreToolUse, matcher Bash).
 *
 * Denies the shell commands that would put a secret or the agent key into the
 * conversation without going through `authoryx_run`:
 *   - running `authoryx fetch`, whose whole job is to print a value;
 *   - printing the whole environment, or AUTHORYX_AGENT_KEY;
 *   - reading the agent key's keychain item.
 * Writes nothing for any other command, which lets it through.
 *
 * It stops accidents and careless models. It is not a sandbox: an agent with a
 * shell can get around any list of patterns. The protection that holds is that
 * no MCP tool returns a value and `run` removes values from what it returns.
 *
 * Protocol: reads the hook payload on stdin; to deny, writes
 *   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}
 */

const USE_RUN = "Use authoryx_run: the value goes to the program, not to this conversation.";

const SEP = String.raw`(?:^|[;&|(\x60]\s*|\$\(\s*|\b(?:sudo|exec|command|xargs|env)\s+)`;
const AUTHORYX = String.raw`(?:npx\s+(?:-y\s+|--yes\s+)?|pnpm\s+(?:dlx\s+)?|bunx\s+)?(?:\S*/)?authoryx(?:@\S+)?`;

export const RULES = [
  {
    re: new RegExp(String.raw`${SEP}${AUTHORYX}(?:\s+--?[\w-]+(?:[ =](?!fetch\b)\S+)?)*\s+fetch\b`),
    why: "`authoryx fetch` prints a secret's value, and this conversation would keep it.",
  },
  {
    re: /(?:^|[;&|(`]\s*)(?:env|printenv|set|export\s+-p|declare\s+-x|declare\s+-p|compgen\s+-e)\s*(?:$|[;&|)`>])/,
    why: "This prints the whole environment, which can hold secrets, into the conversation.",
  },
  { re: /(?:^|[;&|(`]\s*)(?:env|printenv)\s+-0\b/, why: "This prints the whole environment into the conversation." },
  { re: /\bprintenv\s+AUTHORYX_AGENT_KEY\b|\$\{?AUTHORYX_AGENT_KEY\b|process\.env\.AUTHORYX_AGENT_KEY|environ\[['"]AUTHORYX_AGENT_KEY/, why: "This prints the agent key." },
  { re: /\/proc\/(?:self|\d+|\$\$)\/environ\b/, why: "This reads a process's environment, which can hold secrets." },
  { re: /\bsecurity\s+(?:find|dump)-(?:generic|internet)-password\b[^\n]*\bauthoryx\b|\bsecurity\s+dump-keychain\b/, why: "This reads the agent key from the keychain." },
  { re: /\bsecret-tool\s+(?:lookup|search)\b[^\n]*\bauthoryx\b/, why: "This reads the agent key from the keychain." },
  { re: /\bcmdkey\s+\/list\b[^\n]*authoryx|Get-StoredCredential[^\n]*authoryx/i, why: "This reads the agent key from the credential store." },
];

/** The reason to deny `command`, or null to stay silent. */
export function check(command) {
  if (typeof command !== "string" || !command.trim()) return null;
  for (const rule of RULES) {
    if (rule.re.test(command)) return `Blocked by the Authoryx guard: ${rule.why} ${USE_RUN}`;
  }
  return null;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // not a hook payload: stay silent rather than break the session
  }
  if (payload?.tool_name !== "Bash") return;
  const reason = check(String(payload?.tool_input?.command ?? ""));
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
  );
}

const { pathToFileURL } = await import("node:url");
const { realpathSync } = await import("node:fs");
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
