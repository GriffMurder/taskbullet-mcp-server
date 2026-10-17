# @taskbullet/mcp-server

> **MCP server for AI agent → human virtual assistant handoff.** When an agent hits a task it cannot finish (phone calls, 2FA, captcha, physical-world actions, subjective QA), it files the brief with a [TaskBullet](https://taskbullet.com) virtual assistant.

[![npm version](https://img.shields.io/npm/v/@taskbullet/mcp-server.svg)](https://www.npmjs.com/package/@taskbullet/mcp-server)
[![MIT License](https://img.shields.io/npm/l/@taskbullet/mcp-server.svg)](LICENSE)

## TaskBullet Hub

[TaskBullet Hub](https://taskbullet.com/hub) is one MCP connection for agents, with human backup.

There are two servers:

| Server | URL | Auth | What it can do |
|--------|-----|------|----------------|
| Agent (this package, and the hosted remote) | `https://taskbullet.com/api/agent-mcp` | `x-api-key: tb_live_…` | `get_balance`, `delegate_task`, `list_tasks`, `get_task` |
| Public site guide | `https://taskbullet.com/api/mcp` | none | Read-only marketing info: services, pricing, hire vs job-seeker routing |

The public site server does not see customer accounts, emails, work history, or internal docs. Task delegation is only on the agent server.

**Cloud agents (Cursor cloud, Grok, hosted Claude) should use the hosted agent URL.** They cannot run `npx`.

## Tools

| Tool | Calls | Notes |
|------|-------|-------|
| `get_balance` | `GET /api/v1/balance` | Read-only. Call this before proposing spend. |
| `delegate_task` | `POST /api/v1/delegate` | Files a brief. Spends real hours after the customer starts it on Work. |
| `list_tasks` | `GET /api/v1/tasks` | Read-only. Up to 50 tasks. Filter includes `cancelled`. |
| `get_task` | `GET /api/v1/tasks/{taskId}` | Read-only. Stop on `completed`, `failed`, or `cancelled`. |

`delegate_task` arguments: `title` (required), `description`, `priority` (`low` \| `normal` \| `high` \| `urgent`), `dueDate`, `webhookUrl` (https), `maxHours` (default 0.5, max 8), `idempotencyKey` (optional; a key is generated when omitted). Same tool names and the same required arguments as 0.1.x.

A `tb_live_` key files the brief. The customer starts VA hours on Work. `awaiting_customer_start` means the job has not started. Do not say the VA has started. Poll `get_task` until `completed`, `failed`, or `cancelled`, or pass `webhookUrl`. Customer cancel is `cancelled` and does not send the completion webhook.

`maxHours` is a spend cap. Tracked time is what is billed (15-minute rounding). HTTP 402 means a live read is not above zero — buy hours at the `addHoursUrl` (the packages page, not a new trial). HTTP 422 means the cap does not fit open caps: hours remain, lower `maxHours` to `capRoom` or wait. HTTP 503 means hours were unavailable. That is not a buy-hours error.

Never put passwords, OTP codes, recovery keys, cookies, or API keys in a brief. The server drops those locally and the API rejects them.

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

Restart Claude Desktop. The four tools show up in the tools panel.

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

## Completion

1. **Poll** `get_task` until `status` is `completed`, `failed`, or `cancelled`.
2. **Webhook** — pass an https `webhookUrl`. TaskBullet POSTs a signed body when the customer closes the job. A VA checkbox does not send it. A customer cancel does not send it. See the [webhook docs](https://taskbullet.com/docs/agent-api#webhooks).

Pass the same `idempotencyKey` when retrying a brief. The same account and key returns the original task.

## How TaskBullet bills

- Hours are prepaid buckets. They roll over for 90 days.
- Delegated tasks route to the virtual assistant on the account.
- The API call is free. Hours deduct when work is tracked, not when the brief is filed.

Docs: [agent API](https://taskbullet.com/docs/agent-api) · [OpenAPI](https://taskbullet.com/openapi.json) · [site](https://taskbullet.com)

## License

MIT — see [LICENSE](LICENSE).
