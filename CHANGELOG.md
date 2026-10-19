# Changelog

## 0.2.0

- Match the hosted agent MCP at `https://taskbullet.com/api/agent-mcp`: `confirm_task`, `cancel_task`, `reopen_task`, `place_call`, `validate_call`, `get_call`, `update_call`, `cancel_call`, and `get_transcript`, with the same descriptions and input schemas.
- Require `idempotencyKey` on `delegate_task`, `confirm_task`, `cancel_task`, `reopen_task`, and `place_call`, and send it as the `Idempotency-Key` header. 0.1.x generated a key when `delegate_task` omitted one.
- Phone calls are US and Canada only. `record_call` must be false or omitted. The default hold is 5 minutes ($5 for a tier 1 call) when `max_minutes` is omitted.
- `get_balance` includes the calls wallet. `get_task` and `list_tasks` describe `awaitingCustomerConfirm`.

## 0.1.3

- Tool annotations, structured results, server instructions, and validation aligned with the Agent API.
- Optional streamable HTTP stays on loopback unless `TASKBULLET_HTTP_TOKEN` is set.

## 0.1.2

- Official MCP Registry metadata for the npm server and the public site MCP.
