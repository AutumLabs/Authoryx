/**
 * Run a program with secrets in its environment (T1, "Run with secrets").
 *
 * The program is started directly, never through a shell, so nothing in its
 * arguments is interpreted. Its environment is the caller's, without
 * AUTHORYX_AGENT_KEY, plus one variable per value. Its stdout and stderr are
 * read through one redactor per stream and kept in arrival order, up to 1 MB;
 * the agent gets the exit code and that output, never the values.
 */
import { spawn } from "node:child_process";
import type { Value } from "@authoryx/sdk";
import { MIN_SAFE_SECRET_LENGTH, RedactingStream, Redactor } from "./redact.js";

export const OUTPUT_LIMIT_BYTES = 1024 * 1024;

export interface RunResult {
  ran: true;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  /** stdout and stderr interleaved, every value removed, at most 1 MB. */
  output: string;
  truncated: boolean;
  redactions: number;
  note: string | null;
  requestId: string;
}

/** The environment variables a value is given as, and the strings to remove from output. */
export function variablesFor(v: Value): { env: Record<string, string>; secrets: string[] } {
  const k = v.keyName;
  if (v.type === "login") {
    const env: Record<string, string> = { [`${k}_PASSWORD`]: v.password };
    if (v.username !== null) env[`${k}_USERNAME`] = v.username;
    if (v.url !== null) env[`${k}_URL`] = v.url;
    return { env, secrets: [v.password] };
  }
  if (v.type === "totp") return { env: { [k]: v.code }, secrets: [v.code] };
  return { env: { [k]: v.value }, secrets: [v.value] };
}

export interface RunOptions {
  command: readonly string[];
  values: readonly Value[];
  requestId: string;
  timeoutSeconds?: number;
  cwd?: string;
  /** The caller's environment; defaults to process.env. */
  baseEnv?: NodeJS.ProcessEnv;
  outputLimitBytes?: number;
}

export class SpawnError extends Error {
  constructor(readonly program: string, readonly reason: string) {
    super(`Could not start ${program}: ${reason}.`);
  }
}

export async function runProgram(opts: RunOptions): Promise<RunResult> {
  const [program, ...args] = opts.command;
  if (!program) throw new SpawnError("(nothing)", "no program was given");
  const limit = opts.outputLimitBytes ?? OUTPUT_LIMIT_BYTES;
  const timeoutMs = Math.min(600, Math.max(1, opts.timeoutSeconds ?? 120)) * 1000;

  const redactor = new Redactor();
  const env: NodeJS.ProcessEnv = { ...(opts.baseEnv ?? process.env) };
  delete env.AUTHORYX_AGENT_KEY;
  for (const v of opts.values) {
    const { env: vars, secrets } = variablesFor(v);
    Object.assign(env, vars);
    for (const s of secrets) redactor.add(v.keyName, s);
  }

  const child = spawn(program, args, {
    shell: false,
    env,
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  let bytes = 0;
  let truncated = false;
  const append = (s: string) => {
    if (!s || truncated) return;
    const b = Buffer.byteLength(s, "utf8");
    if (bytes + b <= limit) {
      output += s;
      bytes += b;
      return;
    }
    // Cut on a character boundary at the limit.
    const room = Buffer.from(s, "utf8").subarray(0, limit - bytes).toString("utf8").replace(/�$/, "");
    output += room;
    bytes = limit;
    truncated = true;
  };
  const out = new RedactingStream(redactor);
  const err = new RedactingStream(redactor);
  child.stdout.on("data", (c: Buffer) => append(out.push(c)));
  child.stderr.on("data", (c: Buffer) => append(err.push(c)));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  }, timeoutMs);

  const done = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new SpawnError(program, e.code === "ENOENT" ? "no such program on PATH" : e.code ?? e.message));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  append(out.flush());
  append(err.flush());

  const notes: string[] = [];
  if (redactor.shortValues.length) {
    notes.push(
      `${redactor.shortValues.join(", ")} ${redactor.shortValues.length === 1 ? "is" : "are"} shorter than ${MIN_SAFE_SECRET_LENGTH} characters; removing ${redactor.shortValues.length === 1 ? "it" : "them"} may also remove ordinary text from the output.`,
    );
  }
  if (truncated) notes.push(`The output was cut at ${Math.round(limit / 1024)} KB.`);
  if (timedOut) notes.push(`The program was stopped after ${timeoutMs / 1000} seconds.`);
  const redactions = redactor.removals;
  redactor.zero();

  return {
    ran: true,
    exitCode: done.code,
    signal: done.signal,
    timedOut,
    output,
    truncated,
    redactions,
    note: notes.length ? notes.join(" ") : null,
    requestId: opts.requestId,
  };
}
