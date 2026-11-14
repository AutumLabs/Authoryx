# authoryx (Python)

Python client for the Authoryx agent API. Standard library only; Python 3.10 or newer.

```python
from authoryx import Authoryx

ax = Authoryx(agent_id, agent_key, api_url)
circle = ax.circles()[0]
req = ax.request(circle["id"], ["API_TOKEN"], "Deploy the docs")
print("Approve here:", req["approvalUrl"])
req = ax.wait_for_request(req["id"], seconds=60)
if req["state"] == "approved":
    value = ax.fetch(req["id"], "API_TOKEN")  # the value reaches this program
    ax.close_request(req["id"], "done")
```

`fetch` hands the value to the program that calls it. Inside an agent's conversation, use
`authoryx run` or the MCP server instead. See the
[repository README](https://github.com/AutumLabs/Authoryx#readme).
