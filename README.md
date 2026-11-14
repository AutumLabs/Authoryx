# Authoryx agent tools

An AI agent asks to use a secret shared with it, with a reason; the secret's owner approves or
denies on the Authoryx dashboard; then a program the agent starts gets the value, and the agent
gets that program's result.

> **Early access.** Version 0.1.0 is built and tested here but not yet on npm or PyPI. Until it
> is, install from a clone: `npm ci && npm run build && npm link -w authoryx -w @authoryx/mcp`.

## What reaches the agent's conversation

| Reaches the conversation | Never reaches it through an MCP tool |
| --- | --- |
| Circle names, secret names, key names and types, each secret's access state | A secret's value |
| The request, who is awaited, and the approval link | The agent's key |
| A program's exit code and its output, with each value removed | |

`run` removes each value from the output it returns, in plain, base64, hex, URL-encoded and
JSON-escaped form. A program given a value holds it: what that program stores or sends is up to
it. `authoryx fetch` and the SDKs hand the value to the calling program; keep them in scripts you
trust, outside the conversation.

## A first approved run

1. **Create an agent.** In the Authoryx dashboard, create an agent, attach it to a circle that
   has a secret shared into it, and copy the agent's id (`agt_…`) and key (`axa_…`).
2. **Sign in.** `npx -y authoryx login --api <Authoryx API address>`: paste the id, then the key at
   the hidden prompt. It is kept in the OS keychain. Without a keychain (CI, containers), set
   `AUTHORYX_AGENT_ID`, `AUTHORYX_AGENT_KEY` and `AUTHORYX_API_URL` instead.
3. **Ask, then run.**

```bash
authoryx request "<circle>" API_TOKEN --reason "Deploy the docs" --wait   # prints the approval link
authoryx run --request <request id> --key API_TOKEN -- npm run deploy        # API_TOKEN is in its environment
authoryx close <request id>
```

### From an agent host

The MCP server is one command; every host below starts it the same way.

| Host | Add it |
| --- | --- |
| Claude Code | `claude mcp add authoryx -- npx -y @authoryx/mcp`, then `authoryx hooks install` for the guard |
| OpenClaw | `openclaw mcp add`, with the name `authoryx` and the command `npx -y @authoryx/mcp` |
| Hermes | under `mcp_servers:` in its config: `authoryx: { command: npx, args: ["-y", "@authoryx/mcp"] }` |
| Any MCP client | stdio, command `npx -y @authoryx/mcp` |

The agent then lists circles and secrets, asks with a reason, shows you the approval link, runs
programs with `authoryx_run` once you approve, and closes the request.

## Tools

<!-- tools:start -->
| Tool | What it does | Capability | Tier | Never returns |
| --- | --- | --- | --- | --- |
| `authoryx_whoami`, `authoryx whoami` | Show which agent is signed in, the Authoryx API it talks to, and where its key comes from. | Ask | — | the key |
| `authoryx_list_circles`, `authoryx circles` | List the circles this agent is attached to. | Ask | — | members |
| `authoryx_list_secrets`, `authoryx secrets` | List what is shared into one circle, with each secret's key name, type and whether this agent may use it now. | Ask | — | values |
| `authoryx_request_access`, `authoryx request` | Ask to use secrets from a circle, with a reason. The owner approves or denies on the Authoryx dashboard; while they decide, show your person the approval link. | Ask | — | values |
| `authoryx_check_request`, `authoryx status` | Read a request's state, waiting up to 60 seconds for the owner's answer. | Ask | — | values |
| `authoryx_run`, `authoryx run` | Run a program with approved secrets in its environment, each as a variable named by its key. You get the exit code and the output with every value removed. | Run with secrets | T1 | the secret |
| `authoryx_close_request`, `authoryx close` | Close a request when the work is done, so its secrets can no longer be used. | Ask | — | values |
| `authoryx fetch` only | Write one approved value to a pipe for a script. Command line only; never offered to an agent through MCP. | Fetch for scripts | T1 | — (never an MCP tool) |
<!-- tools:end -->

Packages: [`authoryx`](packages/cli) (command line and guard hook), [`@authoryx/mcp`](packages/mcp),
[`@authoryx/sdk`](packages/sdk) (TypeScript), [`authoryx` on PyPI](python/authoryx-sdk) (Python),
[`@authoryx/core`](packages/core) (shared by the others).

## Tiers

Every tool declares how far a value travels from the agent ([docs/tiers.md](docs/tiers.md)).

| Tier | Name | In this release |
| --- | --- | --- |
| T0 | In the chat | Never: no tool puts a value in the conversation |
| T1 | Out of the chat | Run with secrets, Fetch for scripts |
| T2 | Out of the agent's hands | Planned (web sign-in, new account, API call, new secret, export, connectors); each will be switched on per agent from the dashboard |

## Links

- [docs/concepts.md](docs/concepts.md): circles, requests, approvals and the Log
- [docs/tools.md](docs/tools.md): every tool's inputs and results
- [docs/security.md](docs/security.md): what the tools protect against, and their limits
- [docs/troubleshooting.md](docs/troubleshooting.md): exit statuses and common refusals
- [protocol/](protocol/agent-api.md): the agent API these tools speak, with JSON Schemas
- [AGENTS.md](AGENTS.md): building and changing this repository · [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

Apache-2.0. "Authoryx" is a trademark of AutumLabs; see [TRADEMARK.md](TRADEMARK.md).
