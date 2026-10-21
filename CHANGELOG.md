# Changelog

## 0.2.1

- Keep registry name `io.github.GriffMurder/taskbullet` so 0.2.1 updates the live listing. `com.taskbullet/mcp` still needs a DNS TXT or HTTP proof on `taskbullet.com`. Publish steps are in `PUBLISHING.md`.
- Call tool text matches the live quote: tier 1 is $2.50 for the first minute and $1 for each additional minute, so the default 5-minute hold is $6.50. `cancel_call` and `get_transcript` match the hosted agent MCP.
- README leads with phone-call install links for Cursor, VS Code, VS Code Insiders, and Claude Code.
- Cursor plugin and Claude Code marketplace scaffolding live under `plugins/taskbullet`, with a skill for when to use `place_call` or `delegate_task`.

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
