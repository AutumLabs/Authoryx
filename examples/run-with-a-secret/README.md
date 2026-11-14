# Run with a secret

`deploy.mjs` needs `API_TOKEN` and prints only whether it got one and its length. Run it through
Authoryx so the value reaches the script, not your terminal or an agent's conversation:

```bash
authoryx request "<circle>" API_TOKEN --reason "Try the example" --wait
authoryx run --request <request id> --key API_TOKEN -- node examples/run-with-a-secret/deploy.mjs
authoryx close <request id>
```

Try `--key API_TOKEN -- node -e "console.log(process.env.API_TOKEN)"` too: the output shows
`[redacted:API_TOKEN]`.
