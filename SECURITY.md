# Security policy

## Reporting a vulnerability

Email **security@authoryx.com**. Do not open a public issue for anything that would let someone
read a secret or an agent key they should not have.

Say what you did, what happened and what you expected. A clear description is enough; a proof of
concept helps but is not required. We acknowledge within 3 working days with our assessment and a
rough timeline, and if we disagree that something is a vulnerability we say why.

## In scope

This repository holds the agent tools: the SDKs, the command-line tool, the MCP server and the
Claude Code guard hook. In scope:

- Any path by which a secret's value reaches an MCP tool's result, a log, an error, an argument list
  or a file the tools write.
- Output redaction in `run` defeated by an encoding it claims to cover: plain, base64, hex,
  URL-encoded or JSON-escaped, including a value split across two writes.
- The agent key reaching a log, an error, a child program's environment or a file other than the
  OS keychain.

## Documented limits, not defects

- A program given a value through `fetch`, an SDK or `run` holds that value. What it prints, stores
  or sends is up to that program; `run` removes values only from the output it returns.
- The guard hook stops accidents, such as an agent typing `authoryx fetch` or printing its
  environment. It is not a sandbox: an agent with a shell can get around a pattern list.
- Another program on the same machine, running as the same user, can read a running program's
  environment.
- The Authoryx API and dashboard are not in this repository. Report issues with them to the same
  address.

## Supported versions

The latest minor release. There is no long-term support branch before 1.0.
