# Authoryx agent tools

An AI agent asks to use a secret, with a reason; the secret's owner approves or denies it on the
Authoryx dashboard; only then can the agent's program use the value.

> **Early access.** The TypeScript SDK is here. The `authoryx` command-line tool and the MCP server
> are being built in this repository now, and nothing is on npm or PyPI yet.

## What reaches the agent's conversation

| Reaches the conversation | Never reaches it |
| --- | --- |
| Circle names, secret names and key names, each secret's access state | A secret's value, through any MCP tool |
| The request, who is awaited, and the approval link | The agent's key |
| A program's exit code and its output, with each value removed | |

A program given a value through `fetch` or an SDK holds that value: what it prints or stores is
up to that program. Use the SDK in code you trust, outside the conversation.

## A first approved run

1. In the Authoryx dashboard, create an agent, attach it to a circle that has a secret shared
   into it, and copy the agent's id (`agt_…`) and key (`axa_…`).
2. Build the SDK: `git clone https://github.com/AutumLabs/Authoryx && cd Authoryx && npm ci && npm run build`.
3. Ask, wait for the owner's answer, use the value, close the request:

```ts
import { Authoryx } from "@authoryx/sdk";

const ax = new Authoryx({ agentId: process.env.AUTHORYX_AGENT_ID!, agentKey: process.env.AUTHORYX_AGENT_KEY!, apiUrl: process.env.AUTHORYX_API_URL! });
const [circle] = await ax.circles();
let req = await ax.request({ circleId: circle!.id, keyNames: ["API_TOKEN"], reason: "Deploy the docs" });
console.log("Approve here:", req.approvalUrl);
req = await ax.waitForRequest(req.id, { seconds: 60 });
if (req.state === "approved") {
  const value = await ax.fetch(req.id, "API_TOKEN");
  // …use value…
  await ax.closeRequest(req.id, "done");
}
```

## Tools

| Package | What it is | State |
| --- | --- | --- |
| [`@authoryx/sdk`](packages/sdk) | TypeScript client for the agent API | here |
| `authoryx` | Command-line tool: sign in, ask, run a program with a secret | being built |
| `@authoryx/mcp` | MCP server: seven tools, none of which returns a value | being built |
| `authoryx` (PyPI) | Python client | being built |

## Tiers

Every tool declares how far a value travels from the agent.

| Tier | Name | Today |
| --- | --- | --- |
| T0 | In the chat | Never: no tool puts a value in the conversation |
| T1 | Out of the chat | Run with secrets, Fetch for scripts |
| T2 | Out of the agent's hands | Planned, switched on per agent from the dashboard; not in this release |

## Links

- [protocol/agent-api.md](protocol/agent-api.md): the API these tools speak, with JSON Schemas
- [AGENTS.md](AGENTS.md): how this repository is built, for people and coding agents
- [SECURITY.md](SECURITY.md): reporting a vulnerability
- [CONTRIBUTING.md](CONTRIBUTING.md)

Apache-2.0. "Authoryx" is a trademark of AutumLabs; see [TRADEMARK.md](TRADEMARK.md).
