import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "tb_live_supersecret_value";

function testEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("TASKBULLET_") || name.startsWith("CLAUDE_PLUGIN_OPTION_")) delete env[name];
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

function runEntry(
  entry: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(root, entry), ...args], {
      cwd: root,
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes("Ready. Listening on stdio.")) child.kill();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return runEntry("src/index.ts", args, env);
}

test("help works without an API key and does not require a secret", async () => {
  const result = await runCli(["--help"], testEnv());
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--http/);
  assert.match(result.stdout, /TASKBULLET_API_KEY/);
  assert.equal(result.stderr.includes("tb_live"), false);
});

test("missing API key exits with the dashboard hint and no secret", async () => {
  const result = await runCli([], testEnv());
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing TASKBULLET_API_KEY/);
  assert.match(result.stderr, /dashboard\/settings\/api-keys/);
  assert.equal(result.stdout.includes(KEY), false);
});

test("stdio startup logs readiness and never the API key", async () => {
  const result = await runCli([], testEnv({ TASKBULLET_API_KEY: KEY }));
  assert.match(result.stderr, /Ready\. Listening on stdio\./);
  assert.equal(result.stderr.includes(KEY), false);
  assert.equal(result.stdout.includes(KEY), false);
  assert.equal(result.stdout.includes("{"), false);
});

test("plugin entry reads only the userConfig option and ignores the CLI variable", async () => {
  const ignored = await runEntry("src/run.ts", [], testEnv({ TASKBULLET_API_KEY: KEY }));
  assert.equal(ignored.code, 1);
  assert.match(ignored.stderr, /Missing TASKBULLET_API_KEY/);
  assert.equal(ignored.stderr.includes(KEY), false);

  const accepted = await runEntry(
    "src/run.ts",
    [],
    testEnv({ CLAUDE_PLUGIN_OPTION_TASKBULLET_API_KEY: KEY }),
  );
  assert.match(accepted.stderr, /Ready\. Listening on stdio\./);
  assert.equal(accepted.stderr.includes(KEY), false);
  assert.equal(accepted.stdout.includes(KEY), false);
});

test("non-loopback HTTP refuses to start and does not log the key", async () => {
  const result = await runCli(["--http", "--host", "0.0.0.0", "--port", "3999"], testEnv({ TASKBULLET_API_KEY: KEY }));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /non-loopback/);
  assert.equal(result.stderr.includes(KEY), false);
});
