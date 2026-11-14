export { Registry, CAPABILITIES, ALWAYS, granted, isKnownCapability } from "./registry.js";
export type { Capability, Tier, Surface, ToolDef, ToolContext, JSONSchema } from "./registry.js";
export {
  defaultRegistry,
  callTool,
  resolveCircle,
  whoamiTool,
  listCirclesTool,
  listSecretsTool,
  requestAccessTool,
  checkRequestTool,
  closeRequestTool,
  runTool,
  fetchTool,
} from "./tools/index.js";
export { runProgram, variablesFor, OUTPUT_LIMIT_BYTES, SpawnError } from "./run.js";
export type { RunResult, RunOptions } from "./run.js";
export { Redactor, RedactingStream, encodedVariants, redactionToken, MIN_SAFE_SECRET_LENGTH } from "./redact.js";
export { toView, PENDING_NEXT } from "./view.js";
export type { RequestView } from "./view.js";
export { EXIT, ToolError, toToolError, usage, UPGRADE } from "./errors.js";
export {
  keychain,
  memoryKeyStore,
  resolveSignIn,
  readSettings,
  writeSettings,
  removeSettings,
  settingsPath,
  configDir,
  KEYCHAIN_SERVICE,
  AGENT_ID_RE,
  AGENT_KEY_RE,
  NOT_SIGNED_IN,
  NO_API,
} from "./credentials.js";
export type { KeyStore, Settings, SignIn, ResolveOptions } from "./credentials.js";
export { connect, userAgent, debugLogger } from "./connect.js";
export type { ConnectOptions, Product } from "./connect.js";
export { VERSION } from "./version.js";
