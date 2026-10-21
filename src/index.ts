#!/usr/bin/env node
/**
 * npm and Cursor entry. Copies TASKBULLET_API_KEY and TASKBULLET_HTTP_TOKEN
 * into the plugin userConfig options when those options are blank, then starts
 * the server. The Claude plugin does not use this file.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { redact } from "./client.js";
import { fatalSecrets, main } from "./run.js";

function copyIfBlank(option: string | undefined, fromCli: string | undefined, write: (value: string) => void): void {
  if (option?.trim()) return;
  const value = fromCli?.trim();
  if (value) write(value);
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
  copyIfBlank(process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY, process.env.TASKBULLET_API_KEY, (value) => {
    process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY = value;
  });
  copyIfBlank(process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_HTTP_TOKEN, process.env.TASKBULLET_HTTP_TOKEN, (value) => {
    process.env.CLAUDE_PLUGIN_OPTION_TASKBULLET_HTTP_TOKEN = value;
  });
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[taskbullet-mcp-server] Fatal: ${redact(message, fatalSecrets())}`);
    process.exit(1);
  });
}
