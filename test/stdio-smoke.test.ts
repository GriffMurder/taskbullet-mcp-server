import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "tb_live_smoke_secret";
const TOOLS = [
  "cancel_call",
  "cancel_task",
  "confirm_task",
  "delegate_task",
  "get_balance",
  "get_call",
  "get_task",
  "get_transcript",
  "list_tasks",
  "place_call",
  "reopen_task",
  "update_call",
  "validate_call",
];

type Rpc = { id?: number; result?: { serverInfo?: { name?: string; version?: string }; tools?: Array<{ name: string }> }; error?: { message?: string } };

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("TASKBULLET_") || name.startsWith("CLAUDE_PLUGIN_OPTION_")) delete env[name];
  }
  return { ...env, ...extra };
}

function startServer(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let buffer = "";
  const messages: Rpc[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    buffer += text;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) messages.push(JSON.parse(line) as Rpc);
      newline = buffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    child,
    messages,
    output: () => ({ stdout, stderr }),
  };
}

function send(child: ChildProcessWithoutNullStreams, message: Record<string, unknown>) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(messages: Rpc[], id: number, output: () => { stdout: string; stderr: string }) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const found = messages.find((message) => message.id === id);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const { stdout, stderr } = output();
  throw new Error(`timed out waiting for id ${id}\nstdout: ${stdout}\nstderr: ${stderr}`);
}

async function smoke(command: string, args: string[], env: NodeJS.ProcessEnv, version: string) {
  const session = startServer(command, args, env);
  try {
    send(session.child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      },
    });
    const initialized = await waitFor(session.messages, 1, session.output);
    assert.equal(initialized.error, undefined);
    assert.equal(initialized.result?.serverInfo?.name, "taskbullet-mcp-server");
    assert.equal(initialized.result?.serverInfo?.version, version);

    send(session.child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(session.child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await waitFor(session.messages, 2, session.output);
    assert.equal(listed.error, undefined);
    assert.deepEqual((listed.result?.tools ?? []).map((tool) => tool.name).sort(), TOOLS);

    const { stdout, stderr } = session.output();
    assert.equal(stdout.includes(KEY), false);
    assert.equal(stderr.includes(KEY), false);
  } finally {
    session.child.kill();
  }
}

const pkgVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

test("npm server answers initialize and tools/list", async () => {
  await smoke(process.execPath, ["--import", "tsx", join(root, "src/index.ts")], cleanEnv({ TASKBULLET_API_KEY: KEY }), pkgVersion);
});

test("vendored plugin server answers initialize and tools/list", async () => {
  const pluginVersion = (
    JSON.parse(readFileSync(join(root, "plugins/taskbullet/server/package.json"), "utf8")) as { version: string }
  ).version;
  assert.equal(pluginVersion, pkgVersion);
  await smoke(
    process.execPath,
    [join(root, "plugins/taskbullet/server/index.js")],
    cleanEnv({ CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY: KEY }),
    pluginVersion,
  );
});
