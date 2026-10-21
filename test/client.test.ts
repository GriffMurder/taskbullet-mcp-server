import assert from "node:assert/strict";
import test from "node:test";
import {
  createApiClient,
  findSecret,
  formatApiError,
  redact,
  redactValue,
  SlidingWindowLimiter,
} from "../src/client.js";

const KEY = "tb_live_test_fixture_value";

test("redact removes API keys from strings and nested values", () => {
  assert.equal(redact(`key ${KEY} end`, [KEY]), "key tb_[redacted] end");
  const nested = redactValue({ note: `see ${KEY}`, ok: true, n: 1, child: { key: KEY } }, [KEY]) as {
    note: string;
    ok: boolean;
    n: number;
    child: { key: string };
  };
  assert.equal(nested.note.includes(KEY), false);
  assert.equal(nested.child.key.includes("tb_live"), false);
  assert.equal(nested.ok, true);
  assert.equal(nested.n, 1);
});

test("findSecret labels credentials without returning them", () => {
  assert.equal(findSecret("reset the client's password tomorrow"), null);
  assert.equal(findSecret(`use ${KEY}`), "a TaskBullet API key");
  assert.equal(findSecret("token sk_live_abc123"), "a Stripe-style secret key");
  assert.equal(findSecret("aws AKIAIOSFODNN7EXAMPLE"), "an AWS access key");
  assert.equal(findSecret("-----BEGIN PRIVATE KEY-----\nabc"), "a private key");
  assert.equal(findSecret("Authorization: Bearer abcdef12"), "a bearer token");
  assert.equal(findSecret("forward the Bearer documents"), null);
  assert.equal(findSecret("normal brief", KEY), null);
  assert.equal(findSecret(`title ${KEY}`, KEY), "the configured API key");
});

test("formatApiError tells the model what to do next", () => {
  const payment = formatApiError(402, { hoursRemaining: 0, addHoursUrl: "https://taskbullet.com/packages-pricing" }, null);
  assert.match(payment, /packages-pricing/);
  assert.match(payment, /Do not restart a free trial/);
  assert.equal(payment.includes(KEY), false);

  const cap = formatApiError(422, { hoursRemaining: 3, capRoom: 0.25 }, null);
  assert.match(cap, /capRoom=0\.25/);
  assert.match(cap, /not a buy-hours error/);

  const limited = formatApiError(429, { error: `slow down ${KEY}` }, 9);
  assert.match(limited, /Retry after 9 seconds/);
  assert.equal(limited.includes(KEY), false);

  assert.match(formatApiError(503, { hoursUnavailable: true }, null), /not a buy-hours error/);
  assert.match(formatApiError(401, { error: KEY }, null), /api-keys/);

  const callsWallet = formatApiError(402, { error: "payment_required", addFundsUrl: "https://taskbullet.com/api/v1/billing/add-funds" }, null);
  assert.match(callsWallet, /5 minutes/);
  assert.match(callsWallet, /\$6\.50/);
  assert.match(callsWallet, /no trial/);
  assert.match(callsWallet, /add-funds/);

  const country = formatApiError(422, { error: "country_not_enabled", country: "GB", tier: 4 }, null);
  assert.match(country, /Only US and Canada/);
  assert.match(country, /country=GB/);
  assert.match(country, /tier=4/);

  assert.match(formatApiError(409, { error: "dial_started" }, null), /dial_started/);
  assert.match(formatApiError(404, { error: "transcript_not_ready" }, null), /transcript_not_ready/);
});

test("sliding window blocks the call that would exceed the limit", () => {
  let now = 1_000;
  const limiter = new SlidingWindowLimiter(2, 60_000, () => now);
  assert.equal(limiter.take().ok, true);
  assert.equal(limiter.take().ok, true);
  const blocked = limiter.take();
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSeconds >= 1);
  now += 60_000;
  assert.equal(limiter.take().ok, true);
});

test("api client sends the key only as a header and redacts echoed secrets", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ error: `bad ${KEY}` }), { status: 400 });
  };
  const logs: string[] = [];
  const client = createApiClient({
    apiKey: KEY,
    fetchImpl,
    rateLimit: null,
    log: (line) => logs.push(line),
  });
  const result = await client.request("/balance");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message.includes(KEY), false);
  const headers = seen[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], KEY);
  assert.equal(logs.join("\n").includes(KEY), false);
});

test("api client stops before fetch when the local ceiling is reached", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ hoursRemaining: 1 }), { status: 200 });
  };
  const client = createApiClient({
    apiKey: KEY,
    fetchImpl,
    rateLimit: { limit: 1, windowMs: 60_000 },
  });
  assert.equal((await client.request("/balance")).ok, true);
  const second = await client.request("/balance");
  assert.equal(second.ok, false);
  if (!second.ok) assert.match(second.message, /Local rate limit/);
  assert.equal(calls, 1);
});
