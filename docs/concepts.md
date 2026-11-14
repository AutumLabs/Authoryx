# Concepts

**Agent.** A program that acts for a person: Claude Code, OpenClaw, Hermes, a script. In Authoryx
it has an id (`agt_…`) and a key (`axa_…`), created on the agent's page in the dashboard. The key
signs every call; the person can revoke it there at any time.

**Circle.** A group of people and agents. A person shares secrets, or whole vaults, into a circle;
an agent attached to the circle can see what is shared there: names, key names and types, never
values.

**Key name.** How an agent refers to a secret, e.g. `API_TOKEN`. `run` gives the value to a program
in the environment variable of that name; a login becomes `<KEY>_USERNAME`, `<KEY>_PASSWORD` and
`<KEY>_URL`.

**Request.** An agent asks to use one to ten secrets from one circle, with a reason. Each secret's
owner sees the request on the dashboard, with the agent's reason in its own words, and approves
it once or denies it. A request waits five minutes for an answer; an approved secret can be used
for fifteen minutes. An agent has at most five requests waiting at a time.

**Close.** When the work is done, the agent closes the request, and its secrets can no longer be
used through it. Closing is the agent's job: `run` does not close for it.

**The Log.** Every request, answer, use of a value and close is in the Log of the secret's owner
and of the agent's person.

**Capability.** What a tool needs to be offered: `ask`, `run` and `fetch` are always granted; the
T2 ones will be granted per agent from the dashboard. See [tiers.md](tiers.md) and
[../protocol/capabilities.md](../protocol/capabilities.md).
