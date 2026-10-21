/**
 * TaskBullet MCP server entry for the Claude plugin.
 *
 * The API key and the local HTTP token come only from the plugin userConfig
 * values. `.mcp.json` copies those into
 * CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY and
 * CLAUDE_PLUGIN_OPTION_TASKBULLET_HTTP_TOKEN. This file does not read a
 * credential file or any other variable.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { redact } from "./client.js";
import { assertHttpBindAllowed, parsePort, startHttpServer } from "./http.js";
import { createTaskbulletServer } from "./server.js";
import { SERVER_VERSION } from "./version.js";
let activeApiKey = "";
export function fatalSecrets() {
    return activeApiKey ? [activeApiKey] : [];
}
export function parseCli(argv) {
    const cli = { help: false, http: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            cli.help = true;
        }
        else if (arg === "--http") {
            cli.http = true;
        }
        else if (arg === "--host") {
            const value = argv[++i];
            if (!value || value.startsWith("--"))
                throw new Error("--host requires a value");
            cli.host = value;
        }
        else if (arg === "--port") {
            const value = argv[++i];
            if (!value || value.startsWith("--"))
                throw new Error("--port requires a value");
            cli.port = value;
        }
        else {
            throw new Error(`Unknown argument: ${arg ?? ""}`);
        }
    }
    return cli;
}
function trimmed(value) {
    const next = value?.trim();
    return next ? next : undefined;
}
/** userConfig TASKBULLET_API_KEY, injected by .mcp.json. No other source. */
function pluginApiKey() {
    return trimmed(process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY);
}
/** userConfig TASKBULLET_HTTP_TOKEN, injected by .mcp.json. No other source. */
function pluginHttpToken() {
    return trimmed(process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_HTTP_TOKEN);
}
function helpText() {
    return `@taskbullet/mcp-server ${SERVER_VERSION}

Usage:
  taskbullet-mcp-server                 stdio (default)
  taskbullet-mcp-server --http          streamable HTTP at http://127.0.0.1:3000/mcp

Options:
  --http              Serve streamable HTTP instead of stdio
  --host <addr>       Bind address (default 127.0.0.1). Non-loopback requires TASKBULLET_HTTP_TOKEN
  --port <number>     Port (default 3000)
  --help              Show this help

The Claude plugin passes userConfig into CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY
and CLAUDE_PLUGIN_OPTION_TASKBULLET_HTTP_TOKEN. The npm bin copies a blank
option from TASKBULLET_API_KEY and TASKBULLET_HTTP_TOKEN before start.

Environment:
  TASKBULLET_API_KEY                 npm and Cursor only. Never logged.
  TASKBULLET_API_BASE                Default https://taskbullet.com/api/v1
  TASKBULLET_SOURCE_AGENT            Audit label. Default mcp-client
  TASKBULLET_TRANSPORT               Set to http to select streamable HTTP
  TASKBULLET_HTTP_HOST               Default 127.0.0.1
  TASKBULLET_HTTP_PORT               Default 3000
  TASKBULLET_HTTP_TOKEN              npm and Cursor only, when the bind address is not loopback
  TASKBULLET_HTTP_ALLOWED_ORIGINS    Extra browser Origins, comma-separated
`;
}
export async function main(argv = process.argv.slice(2)) {
    const cli = parseCli(argv);
    const http = cli.http || trimmed(process.env.TASKBULLET_TRANSPORT) === "http";
    if (cli.help) {
        console.log(helpText());
        return;
    }
    const apiKey = pluginApiKey();
    if (!apiKey) {
        console.error("[taskbullet-mcp-server] Missing TASKBULLET_API_KEY environment variable.\n" +
            "Generate one at https://taskbullet.com/dashboard/settings/api-keys");
        process.exit(1);
    }
    activeApiKey = apiKey;
    const deps = {
        apiKey,
        apiBase: trimmed(process.env.TASKBULLET_API_BASE) ?? "https://taskbullet.com/api/v1",
        sourceAgent: trimmed(process.env.TASKBULLET_SOURCE_AGENT) ?? "mcp-client",
    };
    if (!http) {
        const server = createTaskbulletServer(deps);
        await server.connect(new StdioServerTransport());
        console.error("[taskbullet-mcp-server] Ready. Listening on stdio.");
        return;
    }
    const host = cli.host ?? trimmed(process.env.TASKBULLET_HTTP_HOST) ?? "127.0.0.1";
    const port = parsePort(cli.port ?? trimmed(process.env.TASKBULLET_HTTP_PORT), 3000);
    const token = pluginHttpToken();
    assertHttpBindAllowed(host, token);
    const allowedOrigins = trimmed(process.env.TASKBULLET_HTTP_ALLOWED_ORIGINS)
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const running = await startHttpServer({ ...deps, host, port, token, allowedOrigins });
    console.error(`[taskbullet-mcp-server] Ready. Listening on ${running.url}`);
}
function invokedDirectly() {
    const entry = process.argv[1];
    if (!entry)
        return false;
    try {
        return import.meta.url === pathToFileURL(realpathSync(entry)).href;
    }
    catch {
        return import.meta.url === pathToFileURL(resolve(entry)).href;
    }
}
if (invokedDirectly()) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[taskbullet-mcp-server] Fatal: ${redact(message, fatalSecrets())}`);
        process.exit(1);
    });
}
