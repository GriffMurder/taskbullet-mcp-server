# @taskbullet/mcp-server

> **MCP server for AI agent → human virtual assistant handoff.** When your AI agent hits a task it can't complete (phone calls, 2FA-gated logins, physical-world actions, subjective QA), delegate it to a real human VA via the [TaskBullet Agent API](https://taskbullet.com/docs/agent-api).

[![npm version](https://img.shields.io/npm/v/@taskbullet/mcp-server.svg)](https://www.npmjs.com/package/@taskbullet/mcp-server)
[![MIT License](https://img.shields.io/npm/l/@taskbullet/mcp-server.svg)](LICENSE)

## What this is

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, Continue, etc.) native tools to delegate tasks to a real human virtual assistant.

LLMs are brilliant at thinking. They are useless at:
- Making phone calls
- Logging into 2FA / captcha-gated portals
- Subjective quality review ("does this look good?")
- Physical-world actions (mail, deliveries, in-person errands)
- Long-tail manual data entry

This server bridges that gap. When your AI agent decides a task is beyond its reach, it calls `delegate_task` and a TaskBullet virtual assistant picks it up.

## Tools exposed

| Tool | Description |
|------|-------------|
| `delegate_task` | Send a new task to a human virtual assistant. Returns a `taskId`. |
| `list_tasks` | List recently delegated tasks, optionally filtered by status. |
| `get_task` | Poll the status and result of a specific task by `taskId`. |

## Install

You need a TaskBullet account and an API key.

1. **Sign up / log in** at [taskbullet.com](https://taskbullet.com)
2. **Generate an API key** at [taskbullet.com/dashboard/settings/api-keys](https://taskbullet.com/dashboard/settings/api-keys)
3. **Wire up the server** in your MCP client config (see below).

## Configure in Claude Desktop

Edit `claude_desktop_config.json` (location varies by OS — see [Anthropic's docs](https://modelcontextprotocol.io/quickstart/user)):

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

Restart Claude Desktop. You'll see the TaskBullet tools appear in the tools panel.

## Configure in Cursor / Continue / other MCP clients

Any client that supports MCP servers via stdio will work. Point it at:

```
command: npx
args:    -y @taskbullet/mcp-server
env:     TASKBULLET_API_KEY=tb_live_...
```

## Configure in custom agent frameworks

For LangChain, CrewAI, AutoGen, or custom orchestration, you can either:
1. Use this MCP server directly via an MCP client library, **OR**
2. Call the underlying [TaskBullet REST API](https://taskbullet.com/docs/agent-api) (or the [OpenAPI spec](https://taskbullet.com/openapi.json)) directly.

## Example: Claude using delegate_task

> **You:** Find me a flight from SFO to Austin next Tuesday under $300. If you can't book it directly, have someone book it for me.
>
> **Claude:** I found a Delta flight at 8:15 AM for $278 but it requires phone booking due to a fare class restriction. Let me delegate the booking to your TaskBullet assistant.
>
> *[calls `delegate_task` with title: "Book Delta DL1423 SFO→AUS Tue Jun 3, 8:15 AM, $278. Use my saved AmEx ending 4321. Email confirmation to me."]*
>
> Booked task `atask_a3f9c2d1`. Your assistant will pick this up and you'll get an email when it's confirmed.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `TASKBULLET_API_KEY` | ✅ | — | Your `tb_live_...` API key |
| `TASKBULLET_API_BASE` | ❌ | `https://taskbullet.com/api/v1` | Override for self-hosted or staging |
| `TASKBULLET_SOURCE_AGENT` | ❌ | `mcp-client` | Audit label for which agent originated the request |

## How task completion is delivered back

You have two options:
1. **Poll** — your agent calls `get_task` periodically until `status === "completed"`.
2. **Webhook** — pass `webhookUrl` to `delegate_task` and TaskBullet POSTs a signed payload when the VA finishes. (See the [webhook docs](https://taskbullet.com/docs/agent-api#webhooks).)

## How TaskBullet works under the hood

- You pre-purchase a **Bucket of Hours** (no monthly retainer).
- Hours **roll over for 90 days** so bursty AI workloads don't waste capacity.
- Tasks delegated through this MCP server route to your matched, dedicated virtual assistant.
- You only spend bucket hours when the VA is actually working on a delegated task — the API itself is free.

Learn more at [taskbullet.com](https://taskbullet.com).

## License

MIT — see [LICENSE](LICENSE).

---

**Keywords:** mcp server, model context protocol, claude, anthropic, ai agent handoff, human-in-the-loop, virtual assistant, AI delegation, autonomous agent, llm tools, agentic workflow
