import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { MAX_BODY_BYTES } from "../src/client.js";
import { assertHttpBindAllowed, startHttpServer } from "../src/http.js";

const KEY = "tb_live_test_fixture_value";

type RawResponse = { status: number; body: string; headers: http.IncomingHttpHeaders };

function rawRequest(options: {
  port: number;
  method: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body ?? "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: options.path ?? "/mcp",
        method: options.method,
        headers: {
          host: `127.0.0.1:${options.port}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function rpc(id: number, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

test("non-loopback HTTP without a token is refused before listen", () => {
  assert.throws(() => assertHttpBindAllowed("0.0.0.0", undefined), /TASKBULLET_HTTP_TOKEN/);
  assert.doesNotThrow(() => assertHttpBindAllowed("127.0.0.1", undefined));
  assert.doesNotThrow(() => assertHttpBindAllowed("0.0.0.0", "local-token"));
});

test("streamable HTTP exposes tools and shares the API rate limit", async () => {
  let calls = 0;
  const running = await startHttpServer({
    apiKey: KEY,
    apiBase: "https://taskbullet.test/api/v1",
    host: "127.0.0.1",
    port: 0,
    rateLimit: { limit: 1, windowMs: 60_000 },
    httpRateLimit: null,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ hoursRemaining: 2, canDelegate: true, hoursUnavailable: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    const init = await rawRequest({
      port: running.port,
      method: "POST",
      body: rpc(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.includes(KEY), false);
    const initialized = JSON.parse(init.body) as { result: { instructions: string; serverInfo: { version: string } } };
    assert.match(initialized.result.instructions, /get_balance/);
    assert.equal(initialized.result.serverInfo.version, "0.1.3");

    const tools = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { "mcp-protocol-version": "2025-11-25" },
      body: rpc(2, "tools/list"),
    });
    assert.equal(tools.status, 200);
    const listed = JSON.parse(tools.body) as { result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> } };
    const balance = listed.result.tools.find((tool) => tool.name === "get_balance");
    assert.equal(balance?.annotations?.readOnlyHint, true);

    const first = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { "mcp-protocol-version": "2025-11-25" },
      body: rpc(3, "tools/call", { name: "get_balance", arguments: {} }),
    });
    assert.equal(first.status, 200);
    assert.match(first.body, /hoursRemaining/);
    assert.equal(first.body.includes(KEY), false);

    const second = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { "mcp-protocol-version": "2025-11-25" },
      body: rpc(4, "tools/call", { name: "get_balance", arguments: {} }),
    });
    assert.match(second.body, /Local rate limit/);
    assert.equal(calls, 1);
  } finally {
    await running.close();
  }
});

test("HTTP transport rejects foreign origins, bad hosts, missing tokens, oversized bodies, and SSE GET", async () => {
  const running = await startHttpServer({
    apiKey: KEY,
    host: "127.0.0.1",
    port: 0,
    token: "http-token-value",
    fetchImpl: async () => new Response("{}", { status: 200 }),
    rateLimit: null,
    httpRateLimit: null,
  });
  try {
    const origin = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { origin: "https://evil.example", authorization: "Bearer http-token-value" },
      body: rpc(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    });
    assert.equal(origin.status, 403);
    assert.match(origin.body, /Origin is not allowed/);
    assert.equal(origin.body.includes(KEY), false);
    assert.equal(origin.body.includes("http-token-value"), false);

    const host = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { host: "evil.example", authorization: "Bearer http-token-value" },
      body: "{}",
    });
    assert.equal(host.status, 403);
    assert.match(host.body, /Host is not allowed/);

    const unauthorized = await rawRequest({
      port: running.port,
      method: "POST",
      body: "{}",
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.includes("http-token-value"), false);

    const missing = await rawRequest({
      port: running.port,
      method: "POST",
      path: "/secret",
      headers: { authorization: "Bearer http-token-value" },
      body: "{}",
    });
    assert.equal(missing.status, 404);

    const sse = await rawRequest({
      port: running.port,
      method: "GET",
      headers: { accept: "text/event-stream", authorization: "Bearer http-token-value" },
    });
    assert.equal(sse.status, 405);

    const oversized = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { authorization: "Bearer http-token-value" },
      body: Buffer.alloc(MAX_BODY_BYTES + 1, 0x61),
    });
    assert.equal(oversized.status, 413);

    const allowed = await rawRequest({
      port: running.port,
      method: "POST",
      headers: { authorization: "Bearer http-token-value" },
      body: rpc(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    });
    assert.equal(allowed.status, 200);
  } finally {
    await running.close();
  }
});

test("HTTP rate limit returns 429 with Retry-After", async () => {
  const running = await startHttpServer({
    apiKey: KEY,
    host: "127.0.0.1",
    port: 0,
    fetchImpl: async () => new Response("{}", { status: 200 }),
    rateLimit: null,
    httpRateLimit: { limit: 1, windowMs: 60_000 },
  });
  try {
    const first = await rawRequest({
      port: running.port,
      method: "POST",
      body: rpc(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    });
    assert.equal(first.status, 200);
    const second = await rawRequest({
      port: running.port,
      method: "POST",
      body: rpc(2, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      }),
    });
    assert.equal(second.status, 429);
    assert.equal(second.headers["retry-after"] !== undefined, true);
    assert.equal(second.body.includes(KEY), false);
  } finally {
    await running.close();
  }
});
