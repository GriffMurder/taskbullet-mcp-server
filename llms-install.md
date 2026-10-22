# Installing the TaskBullet MCP server (for AI agents)

These steps are for an AI agent such as Cline installing `@taskbullet/mcp-server`. They match the [README](README.md).

## 1. Get an API key from the human

The server needs a `tb_live_…` key in `TASKBULLET_API_KEY`. You cannot create it.

1. Ask the human to create a key at https://taskbullet.com/dashboard/settings/api-keys. It is shown once.
2. Ask them to paste it into the MCP config file themselves. Do not ask for the key in chat, and do not write it into any other file, log, or prompt.

## 2. Check Node.js

The server runs with `npx`. Run `node --version`. Node.js must be installed. If it is missing, tell the human.

## 3. Add the server to the MCP settings

Add this entry under `mcpServers` in the client's MCP settings file (for Cline, `cline_mcp_settings.json`). Keep any servers that are already there.

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

The human replaces `tb_live_your_key_here` with the real key before the first call.

### No local Node.js (hosted option)

If the client cannot run `npx`, use the hosted agent server instead:

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

### Optional: public site guide (no key)

`https://taskbullet.com/api/mcp` is a separate, read-only server with marketing info (services, pricing). It cannot place calls or delegate tasks. Add it only if the human wants it:

```json
{
  "mcpServers": {
    "taskbullet-site": {
      "url": "https://taskbullet.com/api/mcp"
    }
  }
}
```

## 4. Verify

Restart or reload the MCP server, then call `get_balance`. It is read-only and spends nothing. A successful reply means the key works.

## Optional environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TASKBULLET_API_BASE` | `https://taskbullet.com/api/v1` | Override for staging |
| `TASKBULLET_SOURCE_AGENT` | `mcp-client` | Audit label stored on each brief |

Leave these out unless the human asks for them.

## Before spending

- `place_call` and `delegate_task` spend real money or hours. Call `get_balance`, and for calls `validate_call`, then confirm with the human before sending.
- Calls are US and Canada numbers only. `record_call` must be false or omitted.
- Never put passwords, one-time codes, or API keys in a brief or a call.
