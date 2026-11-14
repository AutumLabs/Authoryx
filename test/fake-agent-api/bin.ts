/**
 * Start the stand-in agent API on its own, for the quickstart and for trying the
 * tools without an Authoryx account. Prints one JSON line with its address and
 * the agent id and key it issued, then serves until stopped.
 *
 *   node --import tsx test/fake-agent-api/bin.ts [--auto-approve]
 */
import { startFakeApi } from "./server.ts";

const api = await startFakeApi({ autoApprove: process.argv.includes("--auto-approve"), agentName: "Quickstart agent" });
process.stdout.write(JSON.stringify({ url: api.url, agentId: api.agentId, agentKey: api.agentKey, circle: api.circles[0]?.name }) + "\n");
const stop = () => void api.close().then(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
