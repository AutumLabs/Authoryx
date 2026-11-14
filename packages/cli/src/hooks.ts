/**
 * `authoryx hooks install` and `authoryx hooks print` (FR-012): add the guard to
 * Claude Code's settings once, leaving every other hook as it was.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { usage } from "@authoryx/core";

export const NOT_A_SANDBOX =
  "The guard stops accidents, such as an agent running `authoryx fetch` or printing its environment. It is not a sandbox: an agent with a shell can get around it.";

export const guardPath = () => join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard.mjs");

export function guardCommand(): string {
  return `"${process.execPath}" "${guardPath()}"`;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string }[];
}

export function hookSnippet() {
  return { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: guardCommand() }] }] } };
}

const isGuard = (c: string) => /authoryx/i.test(c) && /guard\.mjs/.test(c);

/** Add the guard to the settings file at `file`; returns false when it was already there. */
export function installGuard(file: string): boolean {
  let settings: { hooks?: { PreToolUse?: HookEntry[] } & Record<string, unknown> } & Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw usage(`${file} is not valid JSON; fix it, then run this again.`);
    }
  }
  const hooks = (settings.hooks ??= {});
  const pre = (hooks.PreToolUse ??= []);
  for (const entry of pre) {
    if (entry.hooks?.some((h) => isGuard(h.command))) {
      // Refresh the path in place, in case the package moved.
      entry.hooks = entry.hooks.map((h) => (isGuard(h.command) ? { ...h, command: guardCommand() } : h));
      write(file, settings);
      return false;
    }
  }
  pre.push({ matcher: "Bash", hooks: [{ type: "command", command: guardCommand() }] });
  write(file, settings);
  return true;
}

function write(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function settingsFile(opts: { project?: boolean; cwd?: string; home?: string }): string {
  return opts.project ? join(opts.cwd ?? process.cwd(), ".claude", "settings.json") : join(opts.home ?? homedir(), ".claude", "settings.json");
}
