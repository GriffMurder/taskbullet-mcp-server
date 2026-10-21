# Your AI agent can place a real phone call.

A person dials the number. Your agent gets the answers back. The server is [`@taskbullet/mcp-server`](https://www.npmjs.com/package/@taskbullet/mcp-server).

[![npm version](https://img.shields.io/npm/v/@taskbullet/mcp-server.svg)](https://www.npmjs.com/package/@taskbullet/mcp-server)
[![MIT License](https://img.shields.io/npm/l/@taskbullet/mcp-server.svg)](LICENSE)

## Pricing

$2.50 for the first minute, then $1 per additional minute. The charge comes from the calls wallet, not from prepaid VA hours. US and Canada numbers only. Recording is not available. A system failure that never dials is fully refunded.

`get_balance` shows `balance_cents` (spendable after open holds), `holds_cents`, and `wallet_cents`. The default `max_minutes` is 5. At the rate above, five minutes is $6.50. `validate_call` returns `hold_cents` for the body you are about to send, and it places no hold. Use `hold_cents`.

HTTP 402 `payment_required` means the wallet cannot cover the hold. Add funds at `addFundsUrl`. That read does not create a Stripe session. Calls are pay-as-you-go. There is no trial.

## Example prompts

Copy one of these into the agent after the server is installed. Put the real US or Canada number in the prompt. Do not put a password, a one-time code, or the API key in it.

Book an appointment:

```text
Call the dentist and book me the earliest appointment next Tuesday after 1pm. The office is Bright Smile Dental at (801) 555-0148. Ask which times they have, book one, and bring back the time and any confirmation number. Confirm the hold with me before you place the call. Do not record it.
```

Call a vendor to check an order:

```text
Call Northwind Supply at (415) 555-0199 and check order NW-10442. Ask whether it shipped, the carrier, and the tracking number. Confirm the hold with me before you place the call. US number, no recording.
```

Confirm a reservation:

```text
Call Harbor Grill at (206) 555-0177 and confirm the reservation for Alex Chen, party of 4, this Friday at 7:00pm. Ask them to say the name, time, and party size back. Confirm the hold with me before you place the call. Do not record it.
```

## Install

Create a key at [taskbullet.com/dashboard/settings/api-keys](https://taskbullet.com/dashboard/settings/api-keys). It is shown once. The buttons below install a placeholder `tb_live_your_key_here`. Replace that placeholder in the client config before the first call. Do not paste the real key into chat.

The config runs `npx -y @taskbullet/mcp-server` on your machine. Cloud agents that cannot run `npx` should use the hosted URL in [Cursor and cloud agents](#cursor-and-cloud-agents).

### Cursor

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=taskbullet&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB0YXNrYnVsbGV0L21jcC1zZXJ2ZXIiXSwiZW52Ijp7IlRBU0tCVUxMRVRfQVBJX0tFWSI6InRiX2xpdmVfeW91cl9rZXlfaGVyZSJ9fQ==)
[![Install in Cursor (light)](https://cursor.com/deeplink/mcp-install-light.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=taskbullet&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB0YXNrYnVsbGV0L21jcC1zZXJ2ZXIiXSwiZW52Ijp7IlRBU0tCVUxMRVRfQVBJX0tFWSI6InRiX2xpdmVfeW91cl9rZXlfaGVyZSJ9fQ==)

GitHub does not open `cursor://` links. Copy this into a browser:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=taskbullet&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB0YXNrYnVsbGV0L21jcC1zZXJ2ZXIiXSwiZW52Ijp7IlRBU0tCVUxMRVRfQVBJX0tFWSI6InRiX2xpdmVfeW91cl9rZXlfaGVyZSJ9fQ==
```

Decoded config:

```json
{
  "command": "npx",
  "args": ["-y", "@taskbullet/mcp-server"],
  "env": {
    "TASKBULLET_API_KEY": "tb_live_your_key_here"
  }
}
```

### VS Code

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22taskbullet%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40taskbullet%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22TASKBULLET_API_KEY%22%3A%22tb_live_your_key_here%22%7D%7D)

[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](vscode-insiders:mcp/install?%7B%22name%22%3A%22taskbullet%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40taskbullet%2Fmcp-server%22%5D%2C%22env%22%3A%7B%22TASKBULLET_API_KEY%22%3A%22tb_live_your_key_here%22%7D%7D)

`vscode:mcp/install?` and `vscode-insiders:mcp/install?` carry the same URL-encoded JSON. The `name` is inside that JSON:

```json
{"name":"taskbullet","command":"npx","args":["-y","@taskbullet/mcp-server"],"env":{"TASKBULLET_API_KEY":"tb_live_your_key_here"}}
```

### Claude Code

```bash
claude mcp add taskbullet --env TASKBULLET_API_KEY=tb_live_your_key_here -- npx -y @taskbullet/mcp-server
```

Replace `tb_live_your_key_here` before you run it. From a marketplace, after this repo is on the default branch:

```text
/plugin marketplace add GriffMurder/taskbullet-mcp-server
```

Then install `taskbullet@taskbullet`. The plugin prompts for the key. It does not read a key out of the shell.

### JSON

Claude Desktop and any other stdio client:

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

`claude_desktop_config.json` locations are in the [MCP quickstart](https://modelcontextprotocol.io/quickstart/user). Restart the app after you save the file.

## Tools

Names, arguments, and limits below match the code in `src/server.ts`.

| Tool | Calls | Notes |
|------|-------|-------|
| `get_balance` | `GET /api/v1/balance` | Read-only. Hours and the calls wallet. Call this before proposing spend. |
| `delegate_task` | `POST /api/v1/delegate` | Files a brief. `Idempotency-Key` required. Spends real hours after the customer starts it on Work. |
| `list_tasks` | `GET /api/v1/tasks` | Read-only. Up to 50 tasks. Filter includes `cancelled`. |
| `get_task` | `GET /api/v1/tasks/{taskId}` | Read-only. Stop on `completed`, `failed`, or `cancelled`. `awaitingCustomerConfirm` means ask the human. |
| `confirm_task` | `POST /api/v1/tasks/{taskId}/confirm` | Accepts a delivery and settles tracked hours. `Idempotency-Key` required. Ask the human first. |
| `cancel_task` | `POST /api/v1/tasks/{taskId}/cancel` | Releases the hold and bills only tracked time. `Idempotency-Key` required. Ask the human first. |
| `reopen_task` | `POST /api/v1/tasks/{taskId}/reopen` | Sends the delivery back. `reason` required. `Idempotency-Key` required. Ask the human first. |
| `place_call` | `POST /api/v1/calls` | One human call. US and Canada only. `record_call` must be false or omitted. `Idempotency-Key` required. |
| `validate_call` | `POST /api/v1/calls/validate` | Checks the body. Creates nothing and places no hold. Returns `hold_cents`. |
| `get_call` | `GET /api/v1/calls/{id}` | Read-only. Includes `needs_info` or the final result. |
| `update_call` | `PATCH /api/v1/calls/{id}` | Fills missing fields while the call is `needs_info`. |
| `cancel_call` | `POST /api/v1/calls/{id}/cancel` | Asks ops to cancel. Stays `cancel_pending` until ops confirms. A confirm before any dial refunds the hold. After the dial starts, the error is `cancel_too_late` and the call bills normally. |
| `get_transcript` | `GET /api/v1/calls/{id}/transcript.txt` | VA wrap-up summary, not a recording. `source` is `wrap_up_summary` and `recorded` is false. Empty is `transcript_not_ready`. No dial is `no transcript: call not placed`. Cancel after the dial started is `call_cancelled`. |

`delegate_task` arguments: `title` (required, max 5000), `description` (max 8000), `priority` (`low` \| `normal` \| `high` \| `urgent`, default `normal`), `dueDate`, `sourceAgent`, `webhookUrl` (https), `maxHours` (default 0.5, max 8), `idempotencyKey` (required). The same value is sent as the `Idempotency-Key` header and is not put in the JSON body. A repeat returns the original task.

A `tb_live_` key files the brief. The customer starts VA hours on Work. `awaiting_customer_start` means the job has not started. Do not say the assistant has started. Poll `get_task` until `completed`, `failed`, or `cancelled`, or pass `webhookUrl`. When `get_task` shows `awaitingCustomerConfirm`, ask the human, then `confirm_task`, `cancel_task`, or `reopen_task`. Do not confirm, cancel, or reopen without the human. Customer cancel is `cancelled` and does not send the completion webhook. If nobody confirms, an agent-created task confirms itself after 3 days.

`maxHours` is a spend cap. Tracked time is what is billed (15-minute rounding). HTTP 402 means a live read is not above zero. Buy hours at the `addHoursUrl` (the packages page, not a new trial). HTTP 422 means the cap does not fit open caps: hours remain, lower `maxHours` to `capRoom` or wait. HTTP 503 means hours were unavailable. That is not a buy-hours error.

Never put passwords, OTP codes, recovery keys, cookies, or API keys in a brief or a call. The server drops those locally and the API rejects them.

Human phone calls use `place_call`, not `delegate_task`. Required fields are `phone`, `business_name`, `purpose` (`info`, `scheduling`, `account_servicing`, or `vendor_ops`), `goal` (max 4000), `questions` (1 to 20 items of `{id, ask, type?}`, `id` max 80, `ask` max 1000), `on_behalf_of`, `deadline` (ISO-8601), `consent_attestation` (`true`), and `idempotencyKey`. `max_attempts` defaults to 3 and maxes at 5. `max_minutes` defaults to 5 and maxes at 60. `language` is `en`, `fil`, `tl`, `war`, or `ceb`.

Only US and Canada numbers can be placed. `record_call` must be false or omitted. True is rejected locally and nothing is sent. The hold is the full call: the first minute is the tier minimum, then the per-minute rate. A tier 1 call at the default 5 minutes holds $6.50. `validate_call` is the same body without `idempotencyKey`, and its `hold_cents` is the figure to trust. `valid` stays true when the wallet is short. `warnings` then include `insufficient_balance`. `place_call` is pay-as-you-go from the calls wallet. Poll `get_call`, or pass an https `callback_url`. A call outside weekday 09:00–17:00 in the recipient's time zone needs `allow_outside_business_hours: true` after the customer confirms. The deadline then needs 60 minutes of clock time.

`update_call` takes `call_id` plus any of the same body fields. `get_call`, `cancel_call`, and `get_transcript` take `call_id`.

## TaskBullet Hub

[TaskBullet Hub](https://taskbullet.com/hub) is one MCP connection for agents, with human backup.

There are two servers:

| Server | URL | Auth | What it can do |
|--------|-----|------|----------------|
| Agent (this package, and the hosted remote) | `https://taskbullet.com/api/agent-mcp` | `x-api-key: tb_live_…` | `get_balance`, `delegate_task`, `list_tasks`, `get_task`, `confirm_task`, `cancel_task`, `reopen_task`, `place_call`, `validate_call`, `get_call`, `update_call`, `cancel_call`, `get_transcript` |
| Public site guide | `https://taskbullet.com/api/mcp` | none | Read-only marketing info: services, pricing, hire vs job-seeker routing |

The public site server does not see customer accounts, emails, work history, or internal docs. Task delegation is only on the agent server.

### Cursor and cloud agents

Cloud agents (Cursor cloud, Grok, hosted Claude) should use the hosted agent URL. They cannot run `npx`.

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

### OpenClaw

The lobster cannot create the account or mint a key. Tell the human, in order:

1. No account → https://taskbullet.com/get-started?source=openclaw (10 hours, no card)
2. Issue `tb_live_…` at https://taskbullet.com/dashboard/settings/api-keys (shown once)
3. Paste it into the Gateway env `TASKBULLET_API_KEY` and point Agent MCP at `https://taskbullet.com/api/agent-mcp` with header `x-api-key`. Restart. Never put the key in chat.

Install the skill with `openclaw skills install @griffmurder/taskbullet`. A single human phone call is `place_call` on the calls wallet. Other unfinished work is `get_balance`, confirm spend, then `delegate_task`. No key → the trial URL above. A keyed HTTP 402 on hours is the packages page, not a second trial. A keyed HTTP 402 on a call is add funds, not a trial.

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

The process binds to `127.0.0.1` only. It checks `Host` and `Origin` so a browser page cannot use DNS rebinding to spend the key. Listening on any other address requires `TASKBULLET_HTTP_TOKEN`. Send that token as `Authorization: Bearer …`. It is not the TaskBullet API key.

There is no server-initiated SSE stream. `GET` returns 405. Responses are JSON. Requests are limited to 60 per minute per client address, and upstream calls follow the Agent API ceiling of 60 per minute. Bodies over 32 KiB are rejected.

## Plugins

Cursor: `plugins/taskbullet` bundles this MCP server, `rules/delegate-call-or-task.mdc`, and `skills/place-call-or-delegate/SKILL.md`. Those tell the agent when to use `place_call` and when to use `delegate_task`. The repo marketplace is `.cursor-plugin/marketplace.json`. Submission to the Cursor Marketplace is still manual at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish).

Claude Code: `.claude-plugin/marketplace.json` lists the same plugin. Users add it with `/plugin marketplace add GriffMurder/taskbullet-mcp-server`. Claude Code loads the skill. It does not load the Cursor rule. Claude runs the vendored server with `node ${CLAUDE_PLUGIN_ROOT}/server/index.js` and asks for `TASKBULLET_API_KEY` in the plugin prompt. Cursor keeps using `npx`.

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

## Completion

1. **Poll** `get_task` until `status` is `completed`, `failed`, or `cancelled`. When `awaitingCustomerConfirm` is true, ask the human, then `confirm_task`, `cancel_task`, or `reopen_task`.
2. **Webhook** — pass an https `webhookUrl`. TaskBullet POSTs a signed body when the customer closes the job, and `task.awaiting_confirmation` when a delivery is waiting. A customer cancel does not send `task.completed`. See the [webhook docs](https://taskbullet.com/docs/agent-api#webhooks).
3. **Calls** — poll `get_call` until the call finishes, or pass an https `callback_url`. Read `get_transcript` when the call has a transcript.

`delegate_task`, `confirm_task`, `cancel_task`, `reopen_task`, and `place_call` require `idempotencyKey`. The package sends that value as the `Idempotency-Key` header and does not put it in the JSON body. The same account and key returns the original result.

## How TaskBullet bills hours

- Hours are prepaid buckets. They roll over for 90 days.
- Delegated tasks route to the virtual assistant on the account.
- The API call is free. Hours deduct when work is tracked, not when the brief is filed.
- Phone calls do not spend those hours. They spend the calls wallet.

Docs: [agent API](https://taskbullet.com/docs/agent-api) · [OpenAPI](https://taskbullet.com/openapi.json) · [site](https://taskbullet.com)

## Registry

`mcpName` in this release is `io.github.GriffMurder/taskbullet`. That is the live registry listing. Publishing 0.2.1 updates it. The preferred name `com.taskbullet/mcp` needs a DNS TXT record or an HTTP proof on `taskbullet.com`. That proof is not published yet, so this package does not switch names. Commands, the TXT record, and the directory submissions are in [PUBLISHING.md](PUBLISHING.md).

## License

MIT — see [LICENSE](LICENSE).
