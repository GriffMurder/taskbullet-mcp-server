import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createTaskbulletServer } from "../src/server.js";
import { SERVER_VERSION } from "../src/version.js";

const KEY = "tb_live_test_fixture_value";

type Seen = { url: string; method: string; body?: unknown; headers: Record<string, string> };

function asToolResult(result: unknown): CallToolResult {
  assert.ok(result && typeof result === "object");
  assert.ok("content" in result);
  return result as CallToolResult;
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  assert.equal(block?.type, "text");
  return block.type === "text" ? block.text : "";
}

async function withServer(
  respond: (seen: Seen) => { status: number; body: unknown; headers?: Record<string, string> },
  run: (client: Client, seen: Seen[]) => Promise<void>,
  options: { rateLimit?: { limit: number; windowMs: number } | null } = {},
) {
  const seen: Seen[] = [];
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    const call = { url: String(url), method: init?.method ?? "GET", body, headers };
    seen.push(call);
    const result = respond(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json", ...(result.headers ?? {}) },
    });
  };
  const server = createTaskbulletServer({
    apiKey: KEY,
    apiBase: "https://taskbullet.test/api/v1",
    sourceAgent: "unit-test",
    fetchImpl,
    rateLimit: options.rateLimit ?? null,
    randomUUID: () => "generated-idempotency-key",
    log: (line) => logs.push(line),
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await run(client, seen);
    assert.equal(logs.join("\n").includes(KEY), false);
  } finally {
    await client.close();
    await server.close();
  }
}

test("server instructions, version, and tool annotations match the spec", async () => {
  await withServer(
    () => ({ status: 200, body: {} }),
    async (client) => {
      assert.equal(client.getServerVersion()?.name, "taskbullet-mcp-server");
      assert.equal(client.getServerVersion()?.version, SERVER_VERSION);
      assert.match(client.getInstructions() ?? "", /get_balance before proposing spend/);
      assert.match(client.getInstructions() ?? "", /awaiting_customer_start/);
      assert.match(client.getInstructions() ?? "", /https:\/\/taskbullet.com\/api\/mcp/);

      const { tools } = await client.listTools();
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      assert.deepEqual(Object.keys(byName).sort(), ["delegate_task", "get_balance", "get_task", "list_tasks"]);

      assert.equal(byName.get_balance?.annotations?.readOnlyHint, true);
      assert.equal(byName.get_balance?.annotations?.destructiveHint, false);
      assert.equal(byName.get_balance?.annotations?.idempotentHint, true);
      assert.equal(byName.list_tasks?.annotations?.readOnlyHint, true);
      assert.equal(byName.get_task?.annotations?.readOnlyHint, true);
      assert.equal(byName.delegate_task?.annotations?.readOnlyHint, false);
      assert.equal(byName.delegate_task?.annotations?.destructiveHint, true);
      assert.equal(byName.delegate_task?.annotations?.openWorldHint, true);

      const delegateProps = byName.delegate_task?.inputSchema.properties ?? {};
      assert.ok(delegateProps.maxHours);
      assert.ok(delegateProps.dueDate);
      assert.ok(delegateProps.idempotencyKey);
      assert.deepEqual(byName.delegate_task?.inputSchema.required, ["title"]);
      assert.ok(byName.delegate_task?.outputSchema);
      assert.ok(byName.get_balance?.outputSchema);
      const status = byName.list_tasks?.inputSchema.properties?.status as { enum?: string[] } | undefined;
      assert.ok(status?.enum?.includes("cancelled"));
      const priority = byName.delegate_task?.inputSchema.properties?.priority as { enum?: string[] } | undefined;
      assert.ok(priority?.enum?.includes("urgent"));
    },
  );
});

test("get_balance returns structured content and a helpful 402", async () => {
  await withServer(
    (call) => {
      if (call.url.endsWith("/first")) return { status: 200, body: {} };
      return { status: 402, body: { hoursRemaining: 0, addHoursUrl: "https://taskbullet.com/packages-pricing" } };
    },
    async (client) => {
      const ok = asToolResult(
        await client.callTool({ name: "get_balance", arguments: {} }),
      );
      // The handler above always 402s because the path is /balance. Override by a second server below.
      assert.equal(ok.isError, true);
      assert.match(textOf(ok), /packages-pricing/);
      assert.equal(textOf(ok).includes(KEY), false);
    },
  );

  await withServer(
    () => ({
      status: 200,
      body: { hoursRemaining: 4.5, canDelegate: true, capRoom: 4, hoursUnavailable: false, extra: "kept" },
    }),
    async (client) => {
      const result = asToolResult(await client.callTool({ name: "get_balance", arguments: {} }));
      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent?.hoursRemaining, 4.5);
      assert.equal(result.structuredContent?.canDelegate, true);
      assert.equal(result.structuredContent?.extra, "kept");
      assert.match(textOf(result), /"hoursRemaining": 4.5/);
    },
  );
});

test("delegate_task generates an idempotency key and keeps secrets out of the request", async () => {
  await withServer(
    () => ({ status: 200, body: { success: true, taskId: "atask_123", status: "awaiting_customer_start", message: "Filed." } }),
    async (client, seen) => {
      const result = asToolResult(
        await client.callTool({
          name: "delegate_task",
          arguments: { title: "Book the flight", priority: "urgent", maxHours: 1 },
        }),
      );
      assert.equal(result.structuredContent?.status, "awaiting_customer_start");
      const call = seen[0];
      assert.equal(call?.method, "POST");
      assert.equal(call?.url, "https://taskbullet.test/api/v1/delegate");
      assert.equal(call?.headers["idempotency-key"], "generated-idempotency-key");
      assert.equal(call?.headers["x-api-key"], KEY);
      const body = call?.body as Record<string, unknown>;
      assert.equal(body.title, "Book the flight");
      assert.equal(body.priority, "urgent");
      assert.equal(body.maxHours, 1);
      assert.equal(body.sourceAgent, "unit-test");
      assert.equal("idempotencyKey" in body, false);
      assert.equal(JSON.stringify(body).includes(KEY), false);
    },
  );
});

test("delegate_task reuses a caller idempotency key and refuses secrets locally", async () => {
  await withServer(
    () => ({ status: 200, body: { success: true, taskId: "atask_123", status: "received" } }),
    async (client, seen) => {
      const replay = asToolResult(
        await client.callTool({
          name: "delegate_task",
          arguments: { title: "Book the flight", idempotencyKey: "retry-key-1" },
        }),
      );
      assert.equal(replay.isError, undefined);
      assert.equal(seen[0]?.headers["idempotency-key"], "retry-key-1");

      const blocked = asToolResult(
        await client.callTool({
          name: "delegate_task",
          arguments: { title: "Use this key", description: KEY },
        }),
      );
      assert.equal(blocked.isError, true);
      assert.match(textOf(blocked), /Nothing was sent/);
      assert.equal(textOf(blocked).includes(KEY), false);
      assert.equal(seen.length, 1);
    },
  );
});

test("delegate_task rejects an http webhook before calling the API", async () => {
  await withServer(
    () => ({ status: 200, body: {} }),
    async (client, seen) => {
      const result = asToolResult(
        await client.callTool({
          name: "delegate_task",
          arguments: { title: "Ping me", webhookUrl: "http://example.com/hook" },
        }),
      );
      assert.equal(result.isError, true);
      assert.match(textOf(result), /https/);
      assert.equal(seen.length, 0);
    },
  );
});

test("list_tasks and get_task encode filters and task ids", async () => {
  await withServer(
    (call) => {
      if (call.url.includes("?")) {
        return { status: 200, body: { tasks: [{ taskId: "atask_1", title: "A", status: "cancelled" }] } };
      }
      return { status: 200, body: { taskId: "atask_1", status: "completed", result: "Done" } };
    },
    async (client, seen) => {
      const list = asToolResult(
        await client.callTool({ name: "list_tasks", arguments: { status: "cancelled" } }),
      );
      assert.equal(list.structuredContent?.tasks && (list.structuredContent.tasks as { status: string }[])[0]?.status, "cancelled");
      assert.equal(seen[0]?.url, "https://taskbullet.test/api/v1/tasks?status=cancelled");

      const task = asToolResult(
        await client.callTool({ name: "get_task", arguments: { taskId: "atask_1" } }),
      );
      assert.equal(task.structuredContent?.result, "Done");
      assert.equal(seen[1]?.url, "https://taskbullet.test/api/v1/tasks/atask_1");

      const bad = asToolResult(await client.callTool({ name: "get_task", arguments: { taskId: "../admin" } }));
      assert.equal(bad.isError, true);
      assert.equal(seen.length, 2);
    },
  );
});

test("unknown tool and missing title are tool errors", async () => {
  await withServer(
    () => ({ status: 200, body: {} }),
    async (client, seen) => {
      const missing = asToolResult(await client.callTool({ name: "delegate_task", arguments: {} }));
      assert.equal(missing.isError, true);
      assert.match(textOf(missing), /title is required/);
      const unknown = asToolResult(await client.callTool({ name: "cancel_task", arguments: {} }));
      assert.equal(unknown.isError, true);
      assert.match(textOf(unknown), /not found/);
      assert.equal(seen.length, 0);
    },
  );
});
