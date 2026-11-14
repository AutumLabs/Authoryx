/** A small argument parser: `--flag value`, `--flag=value`, booleans, repeated flags and `--`. */
import { usage } from "@authoryx/core";

export interface Spec {
  /** Flags that take a value. */
  values?: readonly string[];
  /** Flags that may repeat; each takes a value. */
  repeat?: readonly string[];
  /** Flags with no value. */
  bools?: readonly string[];
  /** Flags whose value is optional: --wait or --wait 30. */
  optional?: readonly string[];
}

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true | undefined>;
  lists: Record<string, string[]>;
  /** Everything after `--`. */
  rest: string[];
}

export const GLOBAL: Spec = { values: ["api"], bools: ["json", "debug", "help"] };

export function parse(argv: readonly string[], spec: Spec): Parsed {
  const values = new Set([...(spec.values ?? []), ...(GLOBAL.values ?? [])]);
  const bools = new Set([...(spec.bools ?? []), ...(GLOBAL.bools ?? [])]);
  const repeat = new Set(spec.repeat ?? []);
  const optional = new Set(spec.optional ?? []);
  const out: Parsed = { positional: [], flags: {}, lists: {}, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      out.rest = argv.slice(i + 1) as string[];
      break;
    }
    if (!a.startsWith("--") || a === "-") {
      out.positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq > 0 ? eq : undefined);
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    if (bools.has(name)) {
      if (inline !== undefined) throw usage(`--${name} takes no value.`);
      out.flags[name] = true;
    } else if (values.has(name) || repeat.has(name)) {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === undefined && v.startsWith("--"))) throw usage(`--${name} needs a value.`);
      if (repeat.has(name)) (out.lists[name] ??= []).push(v);
      else out.flags[name] = v;
    } else if (optional.has(name)) {
      const next = argv[i + 1];
      if (inline !== undefined) out.flags[name] = inline;
      else if (next !== undefined && /^\d+$/.test(next)) out.flags[name] = argv[++i] as string;
      else out.flags[name] = true;
    } else {
      throw usage(`Unknown option --${name}. Run authoryx --help.`);
    }
  }
  return out;
}
