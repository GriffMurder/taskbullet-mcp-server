import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SERVER_VERSION } from "../src/version.js";

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
  packages: Array<{ version: string; transport: { type: string } }>;
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
  assert.equal(pkg.version, "0.2.0");
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(pkg.mcpName, "io.github.GriffMurder/taskbullet");
  assert.equal(pkg.mcpName, server.name);
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0]?.version, pkg.version);
  assert.equal(server.packages[0]?.transport.type, "stdio");
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
