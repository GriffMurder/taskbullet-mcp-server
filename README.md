# @taskbullet/mcp-server

> **Human Phone Calls.** An AI agent places a real phone call made by a real person. Structured answers and wrap-up notes come back. US and Canada. $2.50 covers the first minute, then $1 per additional minute. When an agent hits a task it cannot finish (2FA, captcha, physical-world actions, subjective QA), it files the brief with a [TaskBullet](https://taskbullet.com) virtual assistant.

[![npm version](https://img.shields.io/npm/v/@taskbullet/mcp-server.svg)](https://www.npmjs.com/package/@taskbullet/mcp-server)
[![MIT License](https://img.shields.io/npm/l/@taskbullet/mcp-server.svg)](LICENSE)

## TaskBullet Hub

[TaskBullet Hub](https://taskbullet.com/hub) is one MCP connection for agents, with human backup.

There are two servers:

| Server | URL | Auth | What it can do |
|--------|-----|------|----------------|
| Agent (this package, and the hosted remote) | `https://taskbullet.com/api/agent-mcp` | `x-api-key: tb_live_…` | `get_balance`, `delegate_task`, `list_tasks`, `get_task`, `confirm_task`, `cancel_task`, `reopen_task`, `place_call`, `validate_call`, `get_call`, `update_call`, `cancel_call`, `get_transcript` |
| Public site guide | `https://taskbullet.com/api/mcp` | none | Read-only marketing info: services, pricing, hire vs job-seeker routing |

The public site server does not see customer accounts, emails, work history, or internal docs. Task delegation is only on the agent server.

**Cloud agents (Cursor cloud, Grok, hosted Claude) should use the hosted agent URL.** They cannot run `npx`.

## Tools

| Tool | Calls | Notes |
|------|-------|-------|
| `get_balance` | `GET /api/v1/balance` | Read-only. Hours and the calls wallet. Call this before proposing spend. |
| `delegate_task` | `POST /api/v1/delegate` | Files a brief. `Idempotency-Key` required. Spends real hours after the customer starts it on Work. |
| `list_tasks` | `GET /api/v1/tasks` | Read-only. Up to 50 tasks. Filter includes `cancelled`. |
| `get_task` | `GET /api/v1/tasks/{taskId}` | Read-only. Stop on `completed`, `failed`, or `cancelled`. `awaitingCustomerConfirm` means ask the human. |
| `confirm_task` | `POST /api/v1/tasks/{taskId}/confirm` | Accepts a delivery and settles tracked hours. `Idempotency-Key` required. Ask the human first. |
| `cancel_task` | `POST /api/v1/tasks/{taskId}/cancel` | Releases the hold and bills only tracked time. `Idempotency-Key` required. Ask the human first. |
| `reopen_task` | `POST /api/v1/tasks/{taskId}/reopen` | Sends the delivery back. `reason` required. `Idempotency-Key` required. Ask the human first. |
| `place_call` | `POST /api/v1/calls` | One human call. US and Canada only. $2.50 covers the first minute, then $1 per additional minute. Default hold is 5 minutes ($6.50). `Idempotency-Key` required. |
| `validate_call` | `POST /api/v1/calls/validate` | Checks the body. Creates nothing and places no hold. |
| `get_call` | `GET /api/v1/calls/{id}` | Read-only. Includes `needs_info` or the final result. |
| `update_call` | `PATCH /api/v1/calls/{id}` | Fills missing fields while the call is `needs_info`. |
| `cancel_call` | `POST /api/v1/calls/{id}/cancel` | Before the first dial, releases the hold. After dialing, the attempt finishes. |
| `get_transcript` | `GET /api/v1/calls/{id}/transcript.txt` | Read-only. Empty is `transcript_not_ready`. A cancelled call is `call_cancelled`. |

`delegate_task` arguments: `title` (required, max 5000), `description` (max 8000), `priority` (`low` \| `normal` \| `high` \| `urgent`, default `normal`), `dueDate`, `sourceAgent`, `webhookUrl` (https), `maxHours` (default 0.5, max 8), `idempotencyKey` (required). The same value is sent as the `Idempotency-Key` header. A repeat returns the original task.

A `tb_live_` key files the brief. The customer starts VA hours on Work. `awaiting_customer_start` means the job has not started. Do not say the VA has started. Poll `get_task` until `completed`, `failed`, or `cancelled`, or pass `webhookUrl`. When `get_task` shows `awaitingCustomerConfirm`, ask the human, then `confirm_task`, `cancel_task`, or `reopen_task`. Do not confirm, cancel, or reopen without the human. Customer cancel is `cancelled` and does not send the completion webhook. If nobody confirms, an agent-created task confirms itself after 3 days.

`maxHours` is a spend cap. Tracked time is what is billed (15-minute rounding). HTTP 402 means a live read is not above zero — buy hours at the `addHoursUrl` (the packages page, not a new trial). HTTP 422 means the cap does not fit open caps: hours remain, lower `maxHours` to `capRoom` or wait. HTTP 503 means hours were unavailable. That is not a buy-hours error.

Never put passwords, OTP codes, recovery keys, cookies, or API keys in a brief or a call. The server drops those locally and the API rejects them.

Human phone calls use `place_call`, not `delegate_task`. Only US and Canada numbers can be placed. `record_call` must be false or omitted. Recording is not available. The hold is the full call. $2.50 covers the first minute, then $1 per additional minute. `max_minutes` defaults to 5, so the default hold is $6.50. Raise `max_minutes` on that call to hold more, up to 60. `validate_call` checks the same body and places no hold. `place_call` is pay-as-you-go from the calls wallet, with no trial. Poll `get_call`, or pass `callback_url`. A call outside weekday 09:00–17:00 in the recipient's time zone needs `allow_outside_business_hours: true` after the customer confirms. `get_balance` returns `balance_cents` (spendable after open holds), `holds_cents`, and `wallet_cents`. HTTP 402 `payment_required` means the wallet cannot cover the hold. Add funds at `addFundsUrl`. That read does not create a Stripe session.

## Quickstart

Create a key at [taskbullet.com/dashboard/settings/api-keys](https://taskbullet.com/dashboard/settings/api-keys). It is shown once. Put it in the client config or the process environment. Do not paste it into chat.

### Claude Desktop (stdio)

`claude_desktop_config.json` ([locations](https://modelcontextprotocol.io/quickstart/user)):

```json
{
  "mcpServers": {
    "taskbullet": {
      "command": "npx",
      "args": ["-y", "@taskbullet/mcp-server"],
      "env": {
        "TASKBULLET_API_KEY": "tb_live_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The tools show up in the tools panel.

### Cursor (hosted streamable HTTP)

`~/.cursor/mcp.json` or the project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "taskbullet": {
      "url": "https://taskbullet.com/api/agent-mcp",
      "headers": {
        "x-api-key": "tb_live_your_key_here"
      }
    }
  }
}
```

Laptop stdio, if you would rather run the package locally:

```json
{
  "mcpServers": {
    "taskbullet": {
      "command": "npx",
      "args": ["-y", "@taskbullet/mcp-server"],
      "env": {
        "TASKBULLET_API_KEY": "tb_live_your_key_here"
      }
    }
  }
}
```

### OpenClaw

The lobster cannot create the account or mint a key. Tell the human, in order:

1. No account → https://taskbullet.com/get-started?source=openclaw (10 hours, no card)
2. Issue `tb_live_…` at https://taskbullet.com/dashboard/settings/api-keys (shown once)
3. Paste it into the Gateway env `TASKBULLET_API_KEY` and point Agent MCP at `https://taskbullet.com/api/agent-mcp` with header `x-api-key`. Restart. Never put the key in chat.

Install the skill with `openclaw skills install @griffmurder/taskbullet`. Then `get_balance`, confirm spend, and `delegate_task`. No key → the trial URL above. A keyed HTTP 402 is the packages page, not a second trial.

A local Gateway can also launch this package over stdio (`npx -y @taskbullet/mcp-server`) with `TASKBULLET_API_KEY` in the environment.

### Public site guide (no key)

Read-only. Safe to add beside the agent server.

```json
{
  "mcpServers": {
    "taskbullet-site": {
      "url": "https://taskbullet.com/api/mcp"
    }
  }
}
```

Call `understand_site`, then `match_intent`. Job seekers are not hire conversions.

### Local streamable HTTP

Stdio is the default. `--http` serves [streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) on loopback:

```bash
export TASKBULLET_API_KEY="tb_live_your_key_here"
npx -y @taskbullet/mcp-server --http
```

Endpoint: `http://127.0.0.1:3000/mcp`. The key stays in this process. Clients on that machine do not send it.

```json
{
  "mcpServers": {
    "taskbullet": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

The process binds to `127.0.0.1` only. It checks `Host` and `Origin` so a browser page cannot use DNS rebinding to spend the key. Listening on any other address requires `TASKBULLET_HTTP_TOKEN`. Send that token as `Authorization: Bearer …`. It is not the TaskBullet API key.

There is no server-initiated SSE stream. `GET` returns 405. Responses are JSON. Requests are limited to 60 per minute per client address, and upstream calls follow the Agent API ceiling of 60 per minute. Bodies over 32 KiB are rejected.

## Environment

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TASKBULLET_API_KEY` | yes | — | `tb_live_…` key. Read from the environment. Never logged or copied into tool results. |
| `TASKBULLET_API_BASE` | no | `https://taskbullet.com/api/v1` | Override for staging |
| `TASKBULLET_SOURCE_AGENT` | no | `mcp-client` | Audit label stored on each brief |
| `TASKBULLET_TRANSPORT` | no | stdio | Set to `http` to serve streamable HTTP |
| `TASKBULLET_HTTP_HOST` | no | `127.0.0.1` | Bind address. Non-loopback requires a token |
| `TASKBULLET_HTTP_PORT` | no | `3000` | HTTP port |
| `TASKBULLET_HTTP_TOKEN` | when exposed | — | Local HTTP auth. Not the TaskBullet API key |
| `TASKBULLET_HTTP_ALLOWED_ORIGINS` | no | loopback origins | Extra browser `Origin` values, comma-separated |

## Example

> **You:** Find a flight from SFO to Austin next Tuesday under $300. If you cannot book it, have someone book it.
>
> **Claude:** I found Delta at 8:15 AM for $278, but that fare has to be booked by phone. You have hours on the account. I can file this for your assistant — it will not start until you click Start on Work.
>
> *[calls `delegate_task`]*
>
> Filed `atask_a3f9c2d1` as `awaiting_customer_start`. Open Work and click Start. I will check `get_task` after that. I will not invent a confirmation.

> **You:** Call the Austin hotel and ask if they have a room next Tuesday. The number is a US hotel line.
>
> **Claude:** I will check the calls wallet, then `validate_call`. Only US and Canada numbers can be placed. The default hold is 5 minutes: $2.50 for the first minute, then $1 per additional minute, $6.50. Recording is not available. I will send `place_call` after you confirm.
>
> *[calls `validate_call`, then `place_call` with `idempotencyKey` and no `record_call`]*

## Completion

1. **Poll** `get_task` until `status` is `completed`, `failed`, or `cancelled`. When `awaitingCustomerConfirm` is true, ask the human, then `confirm_task`, `cancel_task`, or `reopen_task`.
2. **Webhook** — pass an https `webhookUrl`. TaskBullet POSTs a signed body when the customer closes the job, and `task.awaiting_confirmation` when a delivery is waiting. A customer cancel does not send `task.completed`. See the [webhook docs](https://taskbullet.com/docs/agent-api#webhooks).
3. **Calls** — poll `get_call` until the call finishes, or pass an https `callback_url`. Read `get_transcript` when the call has a transcript.

`delegate_task`, `confirm_task`, `cancel_task`, `reopen_task`, and `place_call` require `idempotencyKey`. The package sends that value as the `Idempotency-Key` header and does not put it in the JSON body. The same account and key returns the original result.

## How TaskBullet bills

- Hours are prepaid buckets. They roll over for 90 days.
- Delegated tasks route to the virtual assistant on the account.
- The API call is free. Hours deduct when work is tracked, not when the brief is filed.

Docs: [agent API](https://taskbullet.com/docs/agent-api) · [OpenAPI](https://taskbullet.com/openapi.json) · [site](https://taskbullet.com)

## License

MIT — see [LICENSE](LICENSE).
