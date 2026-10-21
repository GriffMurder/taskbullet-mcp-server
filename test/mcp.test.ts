import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createTaskbulletServer } from "../src/server.js";
import { SERVER_VERSION } from "../src/version.js";

const KEY = "tb_live_test_fixture_value";

type Seen = { url: string; method: string; body?: unknown; headers: Record<string, string> };

/** Compare JSON Schemas without draft metadata or key order. additionalProperties false is SDK output. */
function schemaShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schemaShape);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (key === "$schema") continue;
    if (key === "additionalProperties" && source[key] === false) continue;
    out[key] = schemaShape(source[key]);
  }
  return out;
}

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
      assert.deepEqual(Object.keys(byName).sort(), [
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
      ]);

      assert.equal(byName.get_balance?.annotations?.readOnlyHint, true);
      assert.equal(byName.get_balance?.annotations?.destructiveHint, false);
      assert.equal(byName.get_balance?.annotations?.idempotentHint, true);
      assert.equal(byName.list_tasks?.annotations?.readOnlyHint, true);
      assert.equal(byName.get_task?.annotations?.readOnlyHint, true);
      assert.equal(byName.validate_call?.annotations?.readOnlyHint, true);
      assert.equal(byName.get_transcript?.annotations?.readOnlyHint, true);
      assert.equal(byName.delegate_task?.annotations?.readOnlyHint, false);
      assert.equal(byName.delegate_task?.annotations?.destructiveHint, true);
      assert.equal(byName.delegate_task?.annotations?.idempotentHint, true);
      assert.equal(byName.delegate_task?.annotations?.openWorldHint, true);
      assert.equal(byName.place_call?.annotations?.readOnlyHint, false);
      assert.equal(byName.confirm_task?.annotations?.destructiveHint, true);

      const delegateProps = byName.delegate_task?.inputSchema.properties ?? {};
      assert.ok(delegateProps.maxHours);
      assert.ok(delegateProps.dueDate);
      assert.ok(delegateProps.idempotencyKey);
      assert.deepEqual(byName.delegate_task?.inputSchema.required, ["title", "idempotencyKey"]);
      assert.deepEqual(byName.place_call?.inputSchema.required, [
        "phone",
        "business_name",
        "purpose",
        "goal",
        "questions",
        "on_behalf_of",
        "deadline",
        "consent_attestation",
        "idempotencyKey",
      ]);
      assert.equal(byName.validate_call?.inputSchema.required, undefined);
      assert.ok(byName.delegate_task?.outputSchema);
      assert.ok(byName.get_balance?.outputSchema);
      const status = byName.list_tasks?.inputSchema.properties?.status as { enum?: string[] } | undefined;
      assert.ok(status?.enum?.includes("cancelled"));
      const priority = byName.delegate_task?.inputSchema.properties?.priority as { enum?: string[]; default?: string } | undefined;
      assert.ok(priority?.enum?.includes("urgent"));
      assert.equal(priority?.default, "normal");
      assert.match(byName.place_call?.description ?? "", /Default max_minutes is 5/);
      assert.match(byName.place_call?.description ?? "", /\$6\.50/);
      assert.equal((byName.place_call?.description ?? "").includes("$5"), false);
      assert.match(byName.place_call?.description ?? "", /Only US and CA are live/);
      assert.match(byName.place_call?.description ?? "", /record_call must be false or omitted/);
      assert.equal((byName.place_call?.description ?? "").toLowerCase().includes("this call may be recorded"), false);
      assert.match(client.getInstructions() ?? "", /record_call must be false or omitted/);
      assert.match(client.getInstructions() ?? "", /place_call, not delegate_task/);
    },
  );
});

test("published tool descriptions and input schemas match the live agent MCP", async () => {
  const live = JSON.parse(readFileSync(new URL("./fixtures/live-tools.json", import.meta.url), "utf8")) as Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
  await withServer(
    () => ({ status: 200, body: {} }),
    async (client) => {
      const { tools } = await client.listTools();
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      for (const expected of live) {
        const actual = byName[expected.name];
        assert.ok(actual, expected.name);
        assert.equal(actual.description, expected.description);
        assert.deepEqual(schemaShape(actual.inputSchema), schemaShape(expected.inputSchema));
      }
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

test("delegate_task sends Idempotency-Key and keeps secrets out of the request", async () => {
  await withServer(
    () => ({ status: 200, body: { success: true, taskId: "atask_123", status: "awaiting_customer_start", message: "Filed." } }),
    async (client, seen) => {
      const result = asToolResult(
        await client.callTool({
          name: "delegate_task",
          arguments: { title: "Book the flight", priority: "urgent", maxHours: 1, idempotencyKey: "generated-idempotency-key" },
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
          arguments: { title: "Use this key", description: KEY, idempotencyKey: "secret-attempt" },
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
          arguments: { title: "Ping me", webhookUrl: "http://example.com/hook", idempotencyKey: "hook-key" },
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
      const unknown = asToolResult(await client.callTool({ name: "no_such_tool", arguments: {} }));
      assert.equal(unknown.isError, true);
      assert.match(textOf(unknown), /not found/);
      assert.equal(seen.length, 0);
    },
  );
});

const callArgs = {
  phone: "202-555-0104",
  business_name: "Front desk",
  purpose: "info",
  goal: "Ask whether a room is open on Tuesday.",
  questions: [{ id: "room", ask: "Is a room available Tuesday?" }],
  on_behalf_of: "Ada Lovelace",
  deadline: "2026-10-21T17:00:00.000Z",
  consent_attestation: true,
  idempotencyKey: "call-key-1",
};

test("place_call sends Idempotency-Key, omits the default hold, and refuses recording", async () => {
  await withServer(
    () => ({ status: 200, body: { call_id: "call_1", status: "queued", hold_cents: 500 } }),
    async (client, seen) => {
      const placed = asToolResult(await client.callTool({ name: "place_call", arguments: callArgs }));
      assert.equal(placed.isError, undefined);
      assert.equal(placed.structuredContent?.hold_cents, 500);
      const call = seen[0];
      assert.equal(call?.method, "POST");
      assert.equal(call?.url, "https://taskbullet.test/api/v1/calls");
      assert.equal(call?.headers["idempotency-key"], "call-key-1");
      const body = call?.body as Record<string, unknown>;
      assert.equal(body.phone, "202-555-0104");
      assert.equal("idempotencyKey" in body, false);
      assert.equal("record_call" in body, false);
      assert.equal("max_minutes" in body, false);
      assert.equal(body.consent_attestation, true);

      const recorded = asToolResult(
        await client.callTool({ name: "place_call", arguments: { ...callArgs, record_call: true } }),
      );
      assert.equal(recorded.isError, true);
      assert.match(textOf(recorded), /record_call must be false or omitted/);
      assert.equal(textOf(recorded).toLowerCase().includes("this call may be recorded"), false);
      assert.equal(seen.length, 1);

      const unconsented = asToolResult(
        await client.callTool({ name: "place_call", arguments: { ...callArgs, consent_attestation: false } }),
      );
      assert.equal(unconsented.isError, true);
      assert.match(textOf(unconsented), /consent_attestation must be true/);
      assert.equal(seen.length, 1);
    },
  );
});

test("validate_call places no hold and does not send an idempotency header", async () => {
  await withServer(
    () => ({ status: 200, body: { hold_cents: 500, recipient_timezone_inferred: true } }),
    async (client, seen) => {
      const { idempotencyKey: _ignored, ...dryRun } = callArgs;
      const result = asToolResult(await client.callTool({ name: "validate_call", arguments: dryRun }));
      assert.equal(result.structuredContent?.hold_cents, 500);
      assert.equal(seen[0]?.method, "POST");
      assert.equal(seen[0]?.url, "https://taskbullet.test/api/v1/calls/validate");
      assert.equal(seen[0]?.headers["idempotency-key"], undefined);
      assert.equal("idempotencyKey" in ((seen[0]?.body as object) ?? {}), false);
    },
  );
});

test("task confirmation writes and call reads use the live paths", async () => {
  await withServer(
    (call) => {
      if (call.url.endsWith("/transcript.txt")) return { status: 200, body: "Hello from the desk." };
      if (call.url.endsWith("/cancel") && call.url.includes("/calls/")) {
        return { status: 409, body: { error: "dial_started" } };
      }
      return { status: 200, body: { taskId: "atask_1", status: "completed", call_id: "call_1" } };
    },
    async (client, seen) => {
      const confirmed = asToolResult(
        await client.callTool({
          name: "confirm_task",
          arguments: { taskId: "atask_1", idempotencyKey: "confirm-1" },
        }),
      );
      assert.equal(confirmed.structuredContent?.status, "completed");
      assert.equal(seen[0]?.method, "POST");
      assert.equal(seen[0]?.url, "https://taskbullet.test/api/v1/tasks/atask_1/confirm");
      assert.equal(seen[0]?.headers["idempotency-key"], "confirm-1");
      assert.equal(seen[0]?.body, undefined);

      const cancelled = asToolResult(
        await client.callTool({
          name: "cancel_task",
          arguments: { taskId: "atask_1", reason: "No longer needed", idempotencyKey: "cancel-1" },
        }),
      );
      assert.equal(cancelled.isError, undefined);
      assert.equal(seen[1]?.url, "https://taskbullet.test/api/v1/tasks/atask_1/cancel");
      assert.deepEqual(seen[1]?.body, { reason: "No longer needed" });

      const reopened = asToolResult(
        await client.callTool({
          name: "reopen_task",
          arguments: { taskId: "atask_1", reason: "Missing two names", idempotencyKey: "reopen-1" },
        }),
      );
      assert.equal(reopened.isError, undefined);
      assert.equal(seen[2]?.url, "https://taskbullet.test/api/v1/tasks/atask_1/reopen");

      const short = asToolResult(
        await client.callTool({
          name: "reopen_task",
          arguments: { taskId: "atask_1", reason: "no", idempotencyKey: "reopen-2" },
        }),
      );
      assert.equal(short.isError, true);
      assert.match(textOf(short), /at least 3 characters/);

      const updated = asToolResult(
        await client.callTool({
          name: "update_call",
          arguments: { call_id: "call_1", goal: "Ask about Tuesday only." },
        }),
      );
      assert.equal(updated.isError, undefined);
      assert.equal(seen[3]?.method, "PATCH");
      assert.equal(seen[3]?.url, "https://taskbullet.test/api/v1/calls/call_1");
      assert.equal(seen[3]?.headers["idempotency-key"], undefined);
      assert.deepEqual(seen[3]?.body, { goal: "Ask about Tuesday only." });

      const transcript = asToolResult(
        await client.callTool({ name: "get_transcript", arguments: { call_id: "call_1" } }),
      );
      assert.equal(textOf(transcript), "Hello from the desk.");
      assert.equal(seen[4]?.url, "https://taskbullet.test/api/v1/calls/call_1/transcript.txt");
      assert.match(seen[4]?.headers.accept ?? "", /text\/plain/);

      const dialling = asToolResult(await client.callTool({ name: "cancel_call", arguments: { call_id: "call_1" } }));
      assert.equal(dialling.isError, true);
      assert.match(textOf(dialling), /dial_started/);
      assert.equal(seen[5]?.method, "POST");
      assert.equal(seen[5]?.url, "https://taskbullet.test/api/v1/calls/call_1/cancel");
      assert.equal(seen.length, 6);
    },
  );
});
