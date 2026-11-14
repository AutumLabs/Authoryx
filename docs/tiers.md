# Tiers

A tier says how far a secret's value travels from the agent. Every tool declares one, with a
capability, in the registry in `packages/core`; a host is offered only the tools whose capability
is granted to the agent.

## T0, In the chat: never

No tool puts a value into the agent's conversation. A conversation is kept in a transcript and
sent back to the model on every turn, so a value that reached it would stay there.

## T1, Out of the chat: in this release

The value reaches a program on the agent's machine, never the conversation.

- **Run with secrets** (`run`): `authoryx_run` and `authoryx run` start a program, without a
  shell, with the values in its environment, and return its exit code and output with each value
  removed.
- **Fetch for scripts** (`fetch`): `authoryx fetch` writes a value to a pipe, and the SDKs return
  it to the calling code. The program that receives it holds it. This is never an MCP tool, and
  the Claude Code guard refuses an agent's attempt to run `authoryx fetch` in its shell.

## T2, Out of the agent's hands: planned

An Authoryx tool uses the value for the agent, so not even the agent's own programs hold it. None
ships in this release. Each is named and its capability id reserved:

| Capability | Name |
| --- | --- |
| `web.signin` | Web sign-in |
| `web.signup` | New account |
| `http.call` | API call |
| `secret.create` | New secret |
| `export` | Export to a service |
| `connector.<service>` | Connector, one per service |

When one is built, it arrives as its own package (`packages/tools-web`, `packages/tools-http`) or
connector (`connectors/<service>/`), and the dashboard grants it per agent through
`whoami.capabilities`. The surfaces do not change: they already list only granted tools.
