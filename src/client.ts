/**
 * TaskBullet Agent API client.
 * The API key is sent only as the x-api-key header and is redacted from every
 * error, log line, and tool result.
 */

export const PACKAGES_URL = "https://taskbullet.com/packages-pricing";
export const API_KEYS_URL = "https://taskbullet.com/dashboard/settings/api-keys";
export const DEFAULT_API_BASE = "https://taskbullet.com/api/v1";
export const API_RATE_LIMIT = 60;
export const API_RATE_WINDOW_MS = 60_000;
export const MAX_BODY_BYTES = 32 * 1024;

const API_KEY_TEXT = /tb_(?:live|test)_[A-Za-z0-9_-]+/gi;

const SECRET_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "a TaskBullet API key", pattern: /tb_(?:live|test)_[A-Za-z0-9]/i },
  { label: "a Stripe-style secret key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]/ },
  { label: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "a bearer token", pattern: /\bBearer\s+(?=[A-Za-z0-9\-._~+/]*\d)[A-Za-z0-9\-._~+/]{8,}/ },
  {
    label: "a JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

export function redact(value: string, extraSecrets: readonly string[] = []): string {
  let out = value.replace(API_KEY_TEXT, "tb_[redacted]");
  for (const secret of extraSecrets) {
    if (secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

export function redactValue(value: unknown, extraSecrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redact(value, extraSecrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, extraSecrets));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[redact(key, extraSecrets)] = redactValue(item, extraSecrets);
    }
    return out;
  }
  return undefined;
}

/** Returns a short label when text looks like a credential. Does not return the secret. */
export function findSecret(text: string, apiKey = ""): string | null {
  if (apiKey.length >= 8 && text.includes(apiKey)) {
    return "the configured API key";
  }
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(text)) return rule.label;
  }
  return null;
}

export class SlidingWindowLimiter {
  private readonly hits: number[] = [];

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const t = this.now();
    while (this.hits.length > 0 && t - (this.hits[0] ?? t) >= this.windowMs) {
      this.hits.shift();
    }
    if (this.hits.length >= this.limit) {
      const oldest = this.hits[0] ?? t;
      const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - (t - oldest)) / 1000));
      return { ok: false, retryAfterSeconds };
    }
    this.hits.push(t);
    return { ok: true };
  }
}

export type ApiResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; message: string };

export type ApiClientOptions = {
  apiBase?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** null disables the client limiter. Default matches the Agent API ceiling. */
  rateLimit?: { limit: number; windowMs: number } | null;
  now?: () => number;
  timeoutMs?: number;
  userAgent?: string;
  log?: (line: string) => void;
};

export type ApiClient = {
  request(
    path: string,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<ApiResult>;
  readonly apiKey: string;
};

function detailFrom(body: unknown): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim().slice(0, 500);
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  return "";
}

function num(body: unknown, key: string): number | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const when = Date.parse(header);
  if (Number.isNaN(when)) return null;
  return Math.max(1, Math.ceil((when - now) / 1000));
}

function errorCode(body: unknown): string | undefined {
  const code = str(body, "error");
  return code && /^[a-z0-9_]+$/.test(code) ? code : undefined;
}

export function formatApiError(status: number, body: unknown, retryAfterSeconds: number | null): string {
  const detail = detailFrom(body);
  const hours = num(body, "hoursRemaining");
  const capRoom = num(body, "capRoom");
  const addHoursUrl = str(body, "addHoursUrl") ?? PACKAGES_URL;
  const suffix = detail ? ` ${detail}` : "";
  const code = errorCode(body);

  switch (status) {
    case 400:
      return (
        "TaskBullet rejected the request (HTTP 400)." +
        suffix +
        " Check field lengths, priority (low, normal, high, or urgent), an https webhookUrl or callback_url, and Idempotency-Key on writes. Do not include passwords, OTP codes, recovery keys, cookies, or API keys."
      );
    case 401:
      return `Unauthorized (HTTP 401). TASKBULLET_API_KEY is missing, invalid, or revoked. Generate a new tb_live_ key at ${API_KEYS_URL}. This server is API key only, not OAuth. Do not paste the key into chat.`;
    case 402: {
      const addFundsUrl = str(body, "addFundsUrl");
      if (code === "payment_required" || (addFundsUrl && hours === undefined)) {
        return `The calls wallet cannot cover the hold (HTTP 402). Add funds at ${addFundsUrl ?? "POST /api/v1/billing/add-funds"}. This is pay-as-you-go and there is no trial. A tier 1 US or Canada call holds $5 at the default 5 minutes.`;
      }
      return `No spendable hours (HTTP 402). A live Ops read is not above zero${hours === undefined ? "" : ` (hoursRemaining=${hours})`}. Buy hours at ${addHoursUrl}. Do not restart a free trial.`;
    }
    case 404:
      if (code === "transcript_not_ready") {
        return "The transcript is empty (HTTP 404 transcript_not_ready).";
      }
      if (code === "not_found") {
        return `Not found (HTTP 404 not_found).${suffix}`;
      }
      return `Not found (HTTP 404).${suffix || " Check the taskId returned by delegate_task."}`;
    case 409: {
      const named: Record<string, string> = {
        not_awaiting_confirm:
          "Nothing has been delivered yet, so there is nothing to confirm (HTTP 409 not_awaiting_confirm).",
        task_closed: "The task is already closed (HTTP 409 task_closed).",
        idempotency_conflict:
          "This Idempotency-Key was already used for a different action, task, or body (HTTP 409 idempotency_conflict).",
        idempotency_in_progress:
          "The first request for this Idempotency-Key is still running (HTTP 409 idempotency_in_progress).",
        dial_started:
          "The call has already started dialing (HTTP 409 dial_started). The current attempt finishes and the hold is not released.",
        call_not_editable: "The call is no longer needs_info, so it cannot be updated (HTTP 409 call_not_editable).",
        call_cancelled: "The call was cancelled (HTTP 409 call_cancelled).",
        too_many_calls: "There are already 5 queued, assigned, or in-progress calls (HTTP 409 too_many_calls).",
      };
      if (code && named[code]) return named[code];
      return `TaskBullet rejected the request (HTTP 409).${suffix}`;
    }
    case 413:
      return "Request is larger than 32 KiB (HTTP 413). Shorten the body.";
    case 422: {
      const country = str(body, "country");
      const tier = num(body, "tier");
      const countryNote = `${country ? ` country=${country}` : ""}${tier === undefined ? "" : ` tier=${tier}`}`;
      if (code === "country_not_enabled" || code === "country_quote_only") {
        return `Only US and Canada calls can be placed (HTTP 422 ${code})${countryNote ? `.${countryNote}` : ""}.`;
      }
      if (code === "number_blocked") {
        return "This number cannot be called (HTTP 422 number_blocked). Premium, toll-free, personal, paging, and shared-cost ranges are blocked.";
      }
      if (code === "field_too_long") {
        const field = str(body, "field");
        const limit = num(body, "limit");
        return `A field is over its limit (HTTP 422 field_too_long)${field ? ` field=${field}` : ""}${limit === undefined ? "" : ` limit=${limit}`}. The value was not truncated.`;
      }
      if (code === "do_not_call") {
        return "This number is on the do-not-call list (HTTP 422 do_not_call). No hold was placed.";
      }
      if (code === "blocked_compliance") {
        return `TaskBullet blocked this call (HTTP 422 blocked_compliance).${suffix} Sales pitches, secrets, and blocked Caribbean NANP ranges are rejected. No hold was placed.`;
      }
      const figures = [
        hours === undefined ? "" : `hoursRemaining=${hours}`,
        capRoom === undefined ? "" : `capRoom=${capRoom}`,
      ].filter(Boolean);
      const detailFigures = figures.length ? ` (${figures.join(", ")})` : "";
      return `The requested maxHours does not fit open caps (HTTP 422). Hours remain${detailFigures}. Lower maxHours to capRoom or wait for open work to finish. This is not a buy-hours error.`;
    }
    case 429: {
      const wait = retryAfterSeconds ?? 60;
      return `Rate limited (HTTP 429). Retry after ${wait} seconds. This ceiling is per API instance and does not hold across instances.`;
    }
    case 503:
      return "Hours are temporarily unavailable (HTTP 503). Ops did not return a live remaining figure. This is not a buy-hours error. Try again later.";
    default:
      return `TaskBullet API error (HTTP ${status}).${suffix}`;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("TASKBULLET_API_KEY is required");
  }
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const limiter =
    options.rateLimit === null
      ? null
      : new SlidingWindowLimiter(
          options.rateLimit?.limit ?? API_RATE_LIMIT,
          options.rateLimit?.windowMs ?? API_RATE_WINDOW_MS,
          now,
        );
  const emit = options.log ?? ((entry: string) => console.error(entry));
  const log = (line: string) => emit(redact(`[taskbullet-mcp-server] ${line}`, [apiKey]));

  return {
    apiKey,
    async request(path, init = {}) {
      if (limiter) {
        const slot = limiter.take();
        if (!slot.ok) {
          log(`local rate limit before ${init.method ?? "GET"} ${path}`);
          return {
            ok: false,
            status: 429,
            message: redact(
              `Local rate limit reached (${limiter.limit} requests per ${Math.round(limiter.windowMs / 1000)} seconds) before calling TaskBullet. Retry after ${slot.retryAfterSeconds} seconds.`,
              [apiKey],
            ),
          };
        }
      }

      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": options.userAgent ?? "taskbullet-mcp-server",
        "x-api-key": apiKey,
        ...init.headers,
      };

      let response: Response;
      try {
        response = await fetchImpl(`${apiBase}${path}`, {
          method: init.method ?? "GET",
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        const message = timedOut
          ? `The TaskBullet API did not respond within ${Math.round(timeoutMs / 1000)} seconds.`
          : "Could not reach the TaskBullet API.";
        log(`network error on ${init.method ?? "GET"} ${path}`);
        return { ok: false, status: 0, message: redact(message, [apiKey]) };
      }

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = text;
        }
      }
      body = redactValue(body, [apiKey]);

      if (!response.ok) {
        const message = redact(
          formatApiError(response.status, body, parseRetryAfter(response.headers.get("retry-after"), now())),
          [apiKey],
        );
        log(`${init.method ?? "GET"} ${path} -> HTTP ${response.status}`);
        return { ok: false, status: response.status, message };
      }
      return { ok: true, status: response.status, body };
    },
  };
}
