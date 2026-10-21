import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SERVER_VERSION } from "../src/version.js";

const MCP_NAME = "io.github.GriffMurder/taskbullet";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
  mcpName: string;
  homepage: string;
};
const server = JSON.parse(readFileSync("server.json", "utf8")) as {
  name: string;
  version: string;
  description: string;
  websiteUrl: string;
  icons: Array<{ src: string; mimeType: string; sizes?: string[] }>;
  packages: Array<{
    version: string;
    identifier: string;
    transport: { type: string };
    environmentVariables: Array<{ name: string; isRequired: boolean; isSecret: boolean }>;
  }>;
  remotes: Array<{ type: string; url: string }>;
};
const site = JSON.parse(readFileSync("server.site.json", "utf8")) as {
  name: string;
  version: string;
  description: string;
  websiteUrl: string;
  packages?: unknown;
  icons: Array<{ src: string }>;
  remotes: Array<{ url: string }>;
};

test("registry metadata stays aligned with the npm package", () => {
  assert.equal(pkg.version, "0.2.1");
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(pkg.mcpName, MCP_NAME);
  assert.equal(pkg.mcpName, server.name);
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0]?.version, pkg.version);
  assert.equal(server.packages[0]?.identifier, "@taskbullet/mcp-server");
  assert.equal(server.packages[0]?.transport.type, "stdio");
  const apiKey = server.packages[0]?.environmentVariables.find((item) => item.name === "TASKBULLET_API_KEY");
  assert.equal(apiKey?.isRequired, true);
  assert.equal(apiKey?.isSecret, true);
  const httpToken = server.packages[0]?.environmentVariables.find((item) => item.name === "TASKBULLET_HTTP_TOKEN");
  assert.equal(httpToken?.isSecret, true);
  assert.equal(server.remotes[0]?.type, "streamable-http");
  assert.equal(server.remotes[0]?.url, "https://taskbullet.com/api/agent-mcp");
  assert.equal(pkg.homepage, "https://taskbullet.com");
  assert.equal(server.websiteUrl, "https://taskbullet.com");
  assert.ok(server.description.length >= 1 && server.description.length <= 100);
  assert.equal(server.icons[0]?.src, "https://taskbullet.com/icons/icon-512x512.png");
  assert.equal(server.icons[0]?.sizes?.[0], "512x512");
  assert.ok(server.icons.every((icon) => icon.src.startsWith("https://") && icon.src.length <= 255));

  assert.equal(site.name, "io.github.GriffMurder/taskbullet-site");
  assert.equal(site.version, "1.0.1");
  assert.equal(site.packages, undefined);
  assert.equal(site.websiteUrl, "https://taskbullet.com");
  assert.equal(site.remotes[0]?.url, "https://taskbullet.com/api/mcp");
  assert.ok(site.description.length >= 1 && site.description.length <= 100);
  assert.ok(site.icons.length >= 1);
});

test("adoption files point at this package version", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /^# Your AI agent can place a real phone call\.\r?\n/);
  assert.match(readme, /\$2\.50/);
  assert.match(readme, /\$6\.50/);
  assert.equal(readme.includes("holds $5"), false);
  assert.match(readme, /io\.github\.GriffMurder\/taskbullet(?!-)/);
  assert.match(readme, /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=taskbullet&config=/);
  assert.match(readme, /vscode:mcp\/install\?/);
  assert.match(readme, /vscode-insiders:mcp\/install\?/);
  assert.match(readme, /claude mcp add taskbullet/);
  assert.match(readme, /com\.taskbullet\/mcp/);
  assert.match(readme, new RegExp(MCP_NAME.replace("/", "\\/")));

  const skill = readFileSync("plugins/taskbullet/skills/place-call-or-delegate/SKILL.md", "utf8");
  assert.match(skill, /^---\r?\nname: place-call-or-delegate\r?\n/);
  assert.match(skill, /place_call/);
  assert.match(skill, /delegate_task/);
  assert.equal(skill.includes("holds $5"), false);

  const claudeMcp = readFileSync("plugins/taskbullet/.mcp.json", "utf8");
  assert.match(claudeMcp, new RegExp(`@taskbullet/mcp-server@${pkg.version}`));
  assert.match(claudeMcp, /\$\{user_config\.taskbullet_api_key\}/);
  const smithery = readFileSync("smithery.yaml", "utf8");
  assert.match(smithery, new RegExp(`@taskbullet/mcp-server@${pkg.version}`));

  const cursorPlugin = JSON.parse(readFileSync("plugins/taskbullet/.cursor-plugin/plugin.json", "utf8")) as {
    name: string;
    version: string;
  };
  const claudePlugin = JSON.parse(readFileSync("plugins/taskbullet/.claude-plugin/plugin.json", "utf8")) as {
    name: string;
    version: string;
  };
  assert.equal(cursorPlugin.name, "taskbullet");
  assert.equal(claudePlugin.name, "taskbullet");
  assert.equal(cursorPlugin.version, pkg.version);
  assert.equal(claudePlugin.version, pkg.version);

  const cursorMarket = JSON.parse(readFileSync(".cursor-plugin/marketplace.json", "utf8")) as {
    plugins: Array<{ name: string; source: string }>;
  };
  const claudeMarket = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8")) as {
    plugins: Array<{ name: string; source: string }>;
  };
  assert.equal(cursorMarket.plugins[0]?.source, "plugins/taskbullet");
  assert.equal(claudeMarket.plugins[0]?.source, "./plugins/taskbullet");
  assert.equal(cursorMarket.plugins[0]?.name, claudeMarket.plugins[0]?.name);
});
