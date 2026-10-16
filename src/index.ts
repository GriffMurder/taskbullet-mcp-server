#!/usr/bin/env node
/**
 * TaskBullet MCP server.
 *
 *   export TASKBULLET_API_KEY="tb_live_..."
 *   npx @taskbullet/mcp-server            # stdio (default)
 *   npx @taskbullet/mcp-server --http     # streamable HTTP on 127.0.0.1:3000/mcp
 *
 * The API key is read from the environment and is never written to logs or tool results.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { redact } from "./client.js";
import { assertHttpBindAllowed, parsePort, startHttpServer } from "./http.js";
import { createTaskbulletServer } from "./server.js";
import { SERVER_VERSION } from "./version.js";

type Cli = {
  help: boolean;
  http: boolean;
  host?: string;
  port?: string;
};

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = { help: false, http: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      cli.help = true;
    } else if (arg === "--http") {
      cli.http = true;
    } else if (arg === "--host") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--host requires a value");
      cli.host = value;
    } else if (arg === "--port") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--port requires a value");
      cli.port = value;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }
  return cli;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function helpText(): string {
  return `@taskbullet/mcp-server ${SERVER_VERSION}

Usage:
  taskbullet-mcp-server                 stdio (default)
  taskbullet-mcp-server --http          streamable HTTP at http://127.0.0.1:3000/mcp

Options:
  --http              Serve streamable HTTP instead of stdio
  --host <addr>       Bind address (default 127.0.0.1). Non-loopback requires TASKBULLET_HTTP_TOKEN
  --port <number>     Port (default 3000)
  --help              Show this help

Environment:
  TASKBULLET_API_KEY                 Required tb_live_ key. Never logged.
  TASKBULLET_API_BASE                Default https://taskbullet.com/api/v1
  TASKBULLET_SOURCE_AGENT            Audit label. Default mcp-client
  TASKBULLET_TRANSPORT               Set to http to select streamable HTTP
  TASKBULLET_HTTP_HOST               Default 127.0.0.1
  TASKBULLET_HTTP_PORT               Default 3000
  TASKBULLET_HTTP_TOKEN              Required when the bind address is not loopback
  TASKBULLET_HTTP_ALLOWED_ORIGINS    Extra browser Origins, comma-separated
`;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const cli = parseCli(argv);
  const http = cli.http || envValue("TASKBULLET_TRANSPORT") === "http";
  if (cli.help) {
    console.log(helpText());
    return;
  }

  const apiKey = envValue("TASKBULLET_API_KEY");
  if (!apiKey) {
    console.error(
      "[taskbullet-mcp-server] Missing TASKBULLET_API_KEY environment variable.\n" +
        "Generate one at https://taskbullet.com/dashboard/settings/api-keys",
    );
    process.exit(1);
  }

  const deps = {
    apiKey,
    apiBase: envValue("TASKBULLET_API_BASE") ?? "https://taskbullet.com/api/v1",
    sourceAgent: envValue("TASKBULLET_SOURCE_AGENT") ?? "mcp-client",
  };

  if (!http) {
    const server = createTaskbulletServer(deps);
    await server.connect(new StdioServerTransport());
    console.error("[taskbullet-mcp-server] Ready. Listening on stdio.");
    return;
  }

  const host = cli.host ?? envValue("TASKBULLET_HTTP_HOST") ?? "127.0.0.1";
  const port = parsePort(cli.port ?? envValue("TASKBULLET_HTTP_PORT"), 3000);
  const token = envValue("TASKBULLET_HTTP_TOKEN");
  assertHttpBindAllowed(host, token);
  const allowedOrigins = envValue("TASKBULLET_HTTP_ALLOWED_ORIGINS")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const running = await startHttpServer({ ...deps, host, port, token, allowedOrigins });
  console.error(`[taskbullet-mcp-server] Ready. Listening on ${running.url}`);
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  }
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[taskbullet-mcp-server] Fatal: ${redact(message, [process.env.TASKBULLET_API_KEY ?? ""])}`);
    process.exit(1);
  });
}
