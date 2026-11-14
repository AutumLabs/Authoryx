#!/usr/bin/env node
/**
 * Repository text checks (FR-020). Fails, naming the file and line, when:
 *  - README.md is over 120 lines or its sections are out of order;
 *  - AGENTS.md is over 150 lines, or CLAUDE.md does more than point to it;
 *  - any tracked text file calls Authoryx or its guard end-to-end, zero-knowledge, HSM-backed or a
 *    sandbox, says an agent cannot see a value it fetches, or describes a T2 tool as available.
 * Run with no arguments from the repository root.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const root = process.cwd();
const problems = [];
const fail = (file, line, msg) => problems.push(`${file}${line ? `:${line}` : ""}: ${msg}`);
const read = (f) => readFileSync(join(root, f), "utf8");

// README: length and order.
const readme = read("README.md").split("\n");
if (readme.length > 121) fail("README.md", 0, `${readme.length - 1} lines; the limit is 120`);
const ORDER = [/^## What reaches the agent's conversation/, /^## A first approved run/, /^## Tools/, /^## Tiers/, /^## Links/];
let at = -1;
for (const re of ORDER) {
  const i = readme.findIndex((l) => re.test(l));
  if (i < 0) fail("README.md", 0, `missing section ${re.source.replace(/^\^## /, "")}`);
  else if (i < at) fail("README.md", i + 1, `section out of order: ${readme[i]}`);
  else at = i;
}

// AGENTS.md and CLAUDE.md.
const agents = read("AGENTS.md").split("\n");
if (agents.length > 151) fail("AGENTS.md", 0, `${agents.length - 1} lines; the limit is 150`);
const claude = read("CLAUDE.md").trim().split("\n");
if (claude.length > 2 || !/AGENTS\.md/.test(claude.join(" "))) fail("CLAUDE.md", 0, "must only point to AGENTS.md");

// Claims the product may not make (NFR-TRUTH-01, NFR-TRUTH-02, ADR-0020).
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".venv", "__pycache__"]);
const TEXT = new Set([".md", ".ts", ".mjs", ".js", ".json", ".py", ".yml", ".yaml", ".txt", ".toml"]);
const SELF = "scripts/check-docs.mjs";
const BANNED = [
  [/\bend[- ]to[- ]end[- ]encrypt/i, "do not call Authoryx end-to-end encrypted"],
  [/\bzero[- ]knowledge\b/i, "do not call Authoryx zero-knowledge"],
  [/\bHSM\b(?!-backed or)/, "do not call Authoryx HSM-protected"],
  [/\b(guard|hook|authoryx)\b[^.\n]{0,40}\bis a sandbox\b/i, "the guard is not a sandbox"],
  [/\bagents? (can ?not|cannot|never) (see|read|access)\b[^.\n]{0,60}\b(fetch|sdk)/i, "an agent sees what it fetches through fetch or an SDK"],
  [/\b(web sign-in|new account|api call|new secret|export to a service|connectors?)\b[^.\n|]{0,40}\b(is|are) (now )?available\b/i, "T2 tools are not available"],
];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (TEXT.has(extname(name)) && !name.endsWith("package-lock.json")) {
      const rel = relative(root, p).split("\\").join("/");
      if (rel === SELF) continue;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        for (const [re, why] of BANNED) if (re.test(line) && !/check-docs: allow/.test(line)) fail(rel, i + 1, why);
      });
    }
  }
}
walk(root);

if (problems.length) {
  console.error(`check-docs: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("check-docs: README, AGENTS.md, CLAUDE.md and wording are in order");
