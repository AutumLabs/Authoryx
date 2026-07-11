import { onAgentStart, onToolCall } from "./hooks.js";
import { fetchSecret } from "./tools.js";

export { configure, client, attach } from "./runtime.js";
export { fetchSecret } from "./tools.js";
export { onAgentStart, onToolCall } from "./hooks.js";

/**
 * Default export — the OpenClaw plugin descriptor.
 */
export default {
  name: "@authoryxos/openclaw-plugin",
  version: "0.1.0",
  hooks: { onAgentStart, onToolCall },
  tools: {
    authoryxos_fetch_secret: fetchSecret,
  },
};
