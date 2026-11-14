# Security

What the tools protect against, how, and where that stops. To report a problem, see
[../SECURITY.md](../SECURITY.md).

## What holds

- **No MCP tool returns a value.** There is no tool, flag or field that does; tests list the tools
  and search every result.
- **`run` removes values from what it returns.** Each value is removed from the program's output
  in plain, base64, hex, URL-encoded and JSON-escaped form, including a value split across two
  writes, and the result says how many were removed. A value shorter than six characters is
  still removed, with a note that ordinary text may go with it.
- **The program is started without a shell**, so `;`, `$()` and quotes in its arguments are plain
  text.
- **The agent key stays out of reach.** It is read from the OS keychain or `AUTHORYX_AGENT_KEY`,
  never from an argument; it is removed from the environment `run` gives a program; it is never
  logged or printed. Debug output (`AUTHORYX_DEBUG=1`) holds only routes, statuses and durations.
- **The owner decides, every time.** The tools can only ask; a value is read only after the
  secret's owner approves, and every step is in the Log.

## Limits

- A program given a value holds it. `run` removes values from the output it returns to the agent;
  what the program writes to a file or sends over the network is up to that program.
- `authoryx fetch` and the SDKs give the value to the calling program. Use them in code you trust,
  not as a way to show a value to an agent.
- The Claude Code guard (`authoryx hooks install`) stops accidents: an agent running
  `authoryx fetch`, printing its environment or reading the keychain item. It is not a sandbox;
  an agent with a shell can get around a list of patterns.
- Another process of the same user on the same machine can read a running program's environment.
