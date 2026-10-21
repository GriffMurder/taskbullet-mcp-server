import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const PLUGIN = "plugins/taskbullet";
const SERVER_FILES = ["client.js", "http.js", "index.js", "server.js", "version.js"];

function stripSourceMap(source: string): string {
  const body = source
    .split("\n")
    .filter((line) => !line.startsWith("//# sourceMappingURL="))
    .join("\n")
    .replace(/\n+$/, "");
  return `${body}\n`;
}

test("claude plugin vendors the server and asks for its secrets", () => {
  const manifest = JSON.parse(readFileSync(`${PLUGIN}/.claude-plugin/plugin.json`, "utf8")) as {
    icon?: string;
    userConfig: Record<string, { type: string; title: string; description: string; sensitive?: boolean; required?: boolean }>;
    documentationUrl?: unknown;
    supportUrl?: unknown;
    privacyPolicyUrl?: unknown;
    termsOfServiceUrl?: unknown;
  };
  assert.equal(manifest.icon, "./.claude-plugin/icon.png");
  assert.equal(manifest.documentationUrl, undefined);
  assert.equal(manifest.supportUrl, undefined);
  assert.equal(manifest.privacyPolicyUrl, undefined);
  assert.equal(manifest.termsOfServiceUrl, undefined);
  for (const key of ["TASKBULLET_API_KEY", "TASKBULLET_HTTP_TOKEN"]) {
    const field = manifest.userConfig[key];
    assert.equal(field?.type, "string");
    assert.equal(field?.sensitive, true);
    assert.equal(typeof field?.title, "string");
    assert.equal(typeof field?.description, "string");
  }
  assert.equal(manifest.userConfig.TASKBULLET_API_KEY?.required, true);
  assert.equal(manifest.userConfig.TASKBULLET_HTTP_TOKEN?.required, undefined);

  const mcp = JSON.parse(readFileSync(`${PLUGIN}/.mcp.json`, "utf8")) as {
    mcpServers: { taskbullet: { command: string; args: string[]; env: Record<string, string> } };
  };
  const server = mcp.mcpServers.taskbullet;
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/server/index.js"]);
  assert.equal(server.env.TASKBULLET_API_KEY, "${user_config.TASKBULLET_API_KEY}");
  assert.equal(server.env.TASKBULLET_HTTP_TOKEN, "${user_config.TASKBULLET_HTTP_TOKEN}");

  const cursor = JSON.parse(readFileSync(`${PLUGIN}/mcp.json`, "utf8")) as {
    mcpServers: { taskbullet: { command: string; args: string[]; env: Record<string, string> } };
  };
  assert.equal(cursor.mcpServers.taskbullet.command, "npx");
  assert.deepEqual(cursor.mcpServers.taskbullet.args, ["-y", "@taskbullet/mcp-server"]);
  assert.equal(cursor.mcpServers.taskbullet.env.TASKBULLET_API_KEY, "${TASKBULLET_API_KEY}");

  const serverPkg = JSON.parse(readFileSync(`${PLUGIN}/server/package.json`, "utf8")) as {
    version: string;
    dependencies: Record<string, string>;
  };
  const rootPkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(serverPkg.version, rootPkg.version);
  assert.equal(serverPkg.dependencies["@modelcontextprotocol/sdk"], "1.32.1");
  assert.equal(serverPkg.dependencies.zod, "3.25.76");
  assert.equal(serverPkg.dependencies["@modelcontextprotocol/sdk"]?.includes("^"), false);
  assert.equal(serverPkg.dependencies.zod.includes("^"), false);

  const lock = JSON.parse(readFileSync(`${PLUGIN}/server/package-lock.json`, "utf8")) as {
    packages: Record<string, { version?: string; integrity?: string }>;
  };
  for (const name of ["node_modules/@modelcontextprotocol/sdk", "node_modules/zod"]) {
    assert.match(lock.packages[name]?.integrity ?? "", /^sha512-/);
    assert.equal(lock.packages[name]?.version, serverPkg.dependencies[name.slice("node_modules/".length)]);
  }

  const icon = readFileSync(`${PLUGIN}/.claude-plugin/icon.png`);
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048);
  assert.ok(icon.length < 2 * 1024 * 1024);

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(PLUGIN);
  assert.ok(files.length < 512);
  for (const path of files) {
    if (path.endsWith(".png")) continue;
    assert.ok(statSync(path).size < 256 * 1024, path);
  }
});

test("vendored plugin server matches the TypeScript build", () => {
  execFileSync("npx", ["tsc"], { stdio: "inherit" });
  for (const name of SERVER_FILES) {
    const built = stripSourceMap(readFileSync(`dist/${name}`, "utf8"));
    const vendored = readFileSync(`${PLUGIN}/server/${name}`, "utf8");
    assert.equal(vendored, built, name);
    assert.ok(vendored.split("\n").length > 5, name);
  }
});
