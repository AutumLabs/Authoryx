# Troubleshooting

Run `authoryx doctor` first: it checks Node, the keychain, the sign-in and the API.

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Done; for `request --wait`, approved | |
| 64 | Usage | Check the command with `authoryx <command> --help` |
| 70 | Unexpected failure | Run again with `--debug`; report it if it repeats |
| 71 | Not signed in, or the sign-in was refused | `authoryx login`, or check `AUTHORYX_AGENT_ID` and `AUTHORYX_AGENT_KEY`; the key may have been revoked |
| 72 | Not found, or out of this agent's reach | Check the circle or request id; the agent may have been detached from the circle |
| 73 | Still waiting for the owner, or not approved | Show the owner the approval link; check again with `authoryx status <id> --wait` |
| 74 | Denied | Open a new request only if the reason changed |
| 75 | Expired | Open a new request |
| 76 | A limit: five requests waiting, or 120 calls a minute | Close requests you no longer need, or wait a minute |
| 77 | The agent API is switched off | Try again later |
| 78 | The API speaks a version this release does not | Upgrade: `npm install -g authoryx@latest` |

`run` passes the program's own exit status through when the program ran.

**No keychain.** On Linux without a Secret Service (most CI runners and containers), `login`
refuses; set the three `AUTHORYX_*` variables instead.

**A Windows `.cmd` program will not start.** `run` starts programs without a shell; run the
program's `.exe`, or `node path/to/script.js`.
