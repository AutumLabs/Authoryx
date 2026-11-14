/**
 * The protocol's JSON Schemas, compiled once. The stand-in API validates every
 * answer it gives, and the SDK tests validate every result they receive, so a
 * drift between the contract, the stand-in and the SDK fails a test rather than
 * a user.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "schemas");

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
for (const f of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(join(dir, f), "utf8")));
}

const BASE = "https://github.com/AutumLabs/Authoryx/blob/main/protocol/schemas/";

export type SchemaName = "circle" | "share" | "shared-vault" | "request" | "value" | "whoami" | "error-envelope";

/** Throws with every violation listed when `data` does not match the named schema. */
export function assertSchema(name: SchemaName, data: unknown): void {
  const validate = ajv.getSchema(`${BASE}${name}.schema.json`);
  if (!validate) throw new Error(`no schema ${name}`);
  if (!validate(data)) {
    throw new Error(`${name} does not match its schema: ${ajv.errorsText(validate.errors)}`);
  }
}
