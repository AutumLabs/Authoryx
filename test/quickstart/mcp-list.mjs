// Start the installed MCP server with one command and ask it for its tool list (AC-048).
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" });
const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
let buf = "";
const timer = setTimeout(() => (console.error("no tool list within 30 s"), process.exit(1)), 30000);
p.stdout.on("data", (d) => {
  buf += d;
  for (;;) {
    const i = buf.indexOf("\n");
    if (i < 0) break;
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (msg.id === 2) {
      clearTimeout(timer);
      console.log(msg.result.tools.map((t) => t.name).join("\n"));
      p.kill();
      process.exit(msg.result.tools.length === 7 ? 0 : 1);
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "quickstart", version: "0" } } });
