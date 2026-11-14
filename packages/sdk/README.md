# @authoryx/sdk

TypeScript client for the Authoryx agent API. No runtime dependency.

```ts
import { Authoryx } from "@authoryx/sdk";

const ax = new Authoryx({ agentId, agentKey, apiUrl });
const [circle] = await ax.circles();
let req = await ax.request({ circleId: circle.id, keyNames: ["API_TOKEN"], reason: "Deploy the docs" });
req = await ax.waitForRequest(req.id, { seconds: 60 });
if (req.state === "approved") {
  const v = await ax.fetch(req.id, "API_TOKEN"); // the value reaches this program
  // use v, then:
  await ax.closeRequest(req.id, "done");
}
```

`fetch` hands the value to the program that calls it. Inside an agent's conversation, use
`authoryx run` or the MCP server, which give the value to a child program instead. See the
[repository README](https://github.com/AutumLabs/Authoryx#readme).
