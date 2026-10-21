/**
 * TaskBullet MCP tools.
 * Names, descriptions, and input schemas match the hosted agent MCP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  API_KEYS_URL,
  createApiClient,
  findSecret,
  PACKAGES_URL,
  type ApiClient,
  type ApiClientOptions,
} from "./client.js";
import { SERVER_VERSION } from "./version.js";

export const SERVER_NAME = "taskbullet-mcp-server";

export const SERVER_INSTRUCTIONS = `Authenticated TaskBullet VA handoff. API key only — not OAuth. The key is read from TASKBULLET_API_KEY and is never logged or repeated in tool results.

Call get_balance before proposing spend. Confirm with the user before delegate_task (real hours, 15-minute rounding, default maxHours 0.5) unless they already said to send it. 402 addHoursUrl is the buy page (${PACKAGES_URL}), not trial, and only when spendable hours are not above zero. A cap that does not fit open caps is 422 with hoursRemaining and capRoom, and hours remain: lower maxHours to capRoom or wait. Missing Basecamp queues the task. When you cannot finish (2FA, captcha, physical-world steps, subjective QA, long manual work), call delegate_task. Poll get_task until completed, failed, or cancelled, or pass webhookUrl. Customer cancel is cancelled, not pending or in_progress, and it does not send the completion webhook. A tb_live_ key files the brief and reads it back. The customer starts VA hours on Work. When get_task shows awaitingCustomerConfirm, ask the human, then confirm_task (settle tracked hours and release the hold), cancel_task (release the hold, bill only tracked time), or reopen_task with a reason. Do not confirm, cancel, or reopen without the human. A task webhook task.awaiting_confirmation fires when a webhookUrl was set. delegate_task status awaiting_customer_start means the job is NOT started until the customer clicks Start on Work. Do not say the VA has started. Never put passwords, OTP codes, recovery keys, cookies, or API keys in delegate_task fields. Never invent VA results. Named prospect, lead, or cold lists: https://taskbullet.com/build-a-list (pay once, CSV — not a scrape, not hours). After the file exists, calling it is last-mile delegate_task. TaskBullet does not place those calls. A single human phone call is place_call. Existing list skips the wizard. Marketing and hire-intent routing is a different server: https://taskbullet.com/api/mcp. Human phone calls use place_call, not delegate_task. place_call dials. delegate_task files a brief and waits for the customer to click Start. It does not dial. The hold is the full call: the tier minimum for the first minute, then the per-minute rate. Default max_minutes is 5, so a tier 1 call holds $6.50. Raise max_minutes on that call to hold more. record_call must be false or omitted. validate_call checks a body and places no hold. get_transcript reads the VA wrap-up summary (source wrap_up_summary, recorded false), not a recording. place_call is pay-as-you-go with no trial. Poll get_call or pass callback_url. Calls outside weekday 09:00–17:00 recipient-local need allow_outside_business_hours: true after the customer confirms.
Keys: ${API_KEYS_URL}.`;

const ICONS: Array<{ src: string; mimeType: string; sizes: string[] }> = [
  {
    src: "https://taskbullet.com/icons/icon-512x512.png",
    mimeType: "image/png",
    sizes: ["512x512"],
  },
  {
    src: "https://taskbullet.com/icons/icon-64x64.png",
    mimeType: "image/png",
    sizes: ["64x64"],
  },
];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const OUTSIDE_HOURS =
  "Set true only after the customer confirms the call may happen outside weekday 09:00–17:00 in the recipient time zone. The deadline then needs 60 minutes of clock time. Omit or false keeps the weekday business-hour rule.";

const balanceOutput = z
  .object({
    hoursRemaining: z.number().optional().describe("Live remaining hours when Ops returned a figure."),
    canDelegate: z
      .boolean()
      .optional()
      .describe(
        "False when hours are unavailable, spendable hours are not above zero, or capRoom is below the minimum new cap.",
      ),
    addHoursUrl: z
      .string()
      .optional()
      .describe("Buy-hours URL. Use it only when a live read is not above zero."),
    hoursUnavailable: z
      .boolean()
      .optional()
      .describe("True when Ops did not return a live remaining figure. Not a buy-hours signal."),
    capRoom: z
      .number()
      .optional()
      .describe("Hours free for a new cap after open caps. Omitted when hours are unavailable."),
    balance_cents: z.number().optional().describe("Spendable calls-wallet cents after open holds."),
    wallet_cents: z.number().optional().describe("balance_cents plus holds_cents."),
    holds_cents: z.number().optional().describe("Sum of unsettled call holds."),
    addFundsUrl: z
      .string()
      .optional()
      .describe("POST /api/v1/billing/add-funds. This read does not create a Stripe session."),
    can_place_call: z.boolean().optional().describe("Whether the calls wallet can place a call."),
  })
  .passthrough();

const delegateOutput = z
  .object({
    success: z.boolean().optional().describe("True when the brief was filed or replayed."),
    taskId: z.string().optional().describe("Stable id for get_task."),
    status: z
      .string()
      .optional()
      .describe(
        "awaiting_customer_start means the customer has not clicked Start on Work. received is a replay after start, a hold, or a sent card.",
      ),
    message: z.string().optional().describe("Human-readable result. Do not claim the VA has started unless the status says so."),
  })
  .passthrough();

const taskSummary = z
  .object({
    taskId: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional().describe("pending, in_progress, completed, failed, or cancelled."),
    priority: z.string().optional(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional(),
    result: z.string().optional().describe("Short result snippet when completed."),
    awaitingCustomerConfirm: z.boolean().optional().describe("True means the human must confirm, cancel, or reopen."),
    amNote: z.string().optional(),
    deliverableLinks: z.array(z.string()).optional(),
  })
  .passthrough();

const listOutput = z
  .object({
    tasks: z.array(taskSummary).optional().describe("Up to 50 recent tasks."),
  })
  .passthrough();

const taskOutput = z
  .object({
    taskId: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional().describe("Stop polling on completed, failed, or cancelled."),
    priority: z.string().optional(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional(),
    result: z.string().optional().describe("Full VA result when completed. Never invent this."),
    awaitingCustomerConfirm: z
      .boolean()
      .optional()
      .describe("True means ask the human, then confirm_task, cancel_task, or reopen_task."),
    amNote: z.string().optional().describe("AM or VA note."),
    deliverableLinks: z.array(z.string()).optional().describe("https links from the note."),
    autoConfirmNote: z.string().optional(),
  })
  .passthrough();

const jsonOutput = z.object({}).passthrough();

function safePathId(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\s/\\]/.test(value) && !value.includes("..");
}

function taskIdField() {
  return z
    .string({ required_error: "taskId is required" })
    .refine((value) => safePathId(value), "taskId is invalid")
    .describe("The taskId returned by delegate_task.");
}

function callIdField() {
  return z.string({ required_error: "call_id is required" }).refine((value) => safePathId(value), "call_id is invalid");
}

function idempotencyField(description: string) {
  return z.string({ required_error: "idempotencyKey is required" }).describe(description);
}

const httpsUrl = z.string().url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "webhookUrl must be an https URL");

const delegateInput = z.object({
  title: z
    .string({ required_error: "title is required" })
    .max(5000)
    .describe("Concise directive (max 5000 chars)."),
  description: z
    .string()
    .max(8000)
    .optional()
    .describe(
      "Detailed context, instructions, and constraints (max 8000 chars). Never include passwords, OTP codes, recovery keys, cookies, or API keys.",
    ),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueDate: z.string().max(120).optional().describe("Optional human-readable due date (e.g. EOD Friday)."),
  sourceAgent: z
    .string()
    .max(80)
    .optional()
    .describe("Optional calling-agent label for the audit trail (e.g. grok-bot)."),
  webhookUrl: httpsUrl.optional().describe("Optional public HTTPS callback URL."),
  maxHours: z
    .number()
    .min(0.01)
    .max(8)
    .optional()
    .describe(
      "Spend cap in hours (default 0.5). VA/AM stop and ask before exceeding. Actual tracked time is billed, not this cap. Max 8.",
    ),
  idempotencyKey: idempotencyField(
    "Same value as the REST Idempotency-Key header. Required. A repeat returns the original task.",
  ),
});

const listInput = z.object({
  status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled", "all"]).default("all"),
});

const getInput = z.object({
  taskId: taskIdField(),
});

const confirmInput = z.object({
  taskId: taskIdField(),
  idempotencyKey: idempotencyField("Same value as the REST Idempotency-Key header. Required."),
});

const cancelTaskInput = z.object({
  taskId: taskIdField(),
  reason: z.string().optional().describe("Optional note. Do not include secrets."),
  idempotencyKey: idempotencyField("Same value as the REST Idempotency-Key header. Required."),
});

const reopenInput = z.object({
  taskId: taskIdField(),
  reason: z.string({ required_error: "reason is required" }).describe("What should happen next. Required. Do not include secrets."),
  idempotencyKey: idempotencyField("Same value as the REST Idempotency-Key header. Required."),
});

const placeQuestion = z
  .object({
    id: z.string().max(80),
    ask: z.string().max(1000).describe("At least 8 characters."),
    type: z.string().optional(),
  })
  .strict();

const validateQuestion = z.object({
  id: z.string(),
  ask: z.string(),
  type: z.string().optional(),
});

const purpose = z.enum(["info", "scheduling", "account_servicing", "vendor_ops"]);
const scriptMode = z.enum(["guided", "verbatim"]);

const placeInput = z.object({
  phone: z
    .string({ required_error: "phone is required" })
    .describe("US or Canada number. 801-414-4664, (801) 414-4664, and +1 801 414 4664 are accepted and stored as E.164."),
  extension: z.string().optional().describe("Optional digits. Passed into the VA instructions. Not billed."),
  language: z.string().optional().describe("en, fil, tl, war, or ceb. Default en."),
  business_name: z.string({ required_error: "business_name is required" }),
  purpose,
  goal: z.string({ required_error: "goal is required" }).max(4000),
  record_call: z.boolean().optional().describe("False or omit. True is rejected: recording is not available."),
  script_mode: scriptMode.optional(),
  script: z.string().optional(),
  instructions: z.string().optional().describe("Outranks script wording. The extension is appended for the VA."),
  questions: z
    .array(placeQuestion)
    .max(20)
    .describe("One to 20 questions. Each item is {id, ask, type?}."),
  allowed_disclosures: z.string().optional(),
  on_behalf_of: z.string({ required_error: "on_behalf_of is required" }),
  shareable_contact: z.string().optional(),
  deadline: z
    .string({ required_error: "deadline is required" })
    .describe(
      "ISO-8601. Needs 60 minutes of weekday 09:00–17:00 recipient-local, unless allow_outside_business_hours is true.",
    ),
  time_window: z
    .string()
    .optional()
    .describe("Optional 24-hour HH:MM-HH:MM in the recipient time zone. Example: 09:00-17:00. End must be after start."),
  recipient_timezone: z
    .string()
    .optional()
    .describe("IANA zone. Omit it and TaskBullet infers a US or Canada area code. An uninferable number needs this field."),
  retry_preference: z.any().optional(),
  allow_outside_business_hours: z.boolean().optional().describe(OUTSIDE_HOURS),
  consent_attestation: z.boolean({ required_error: "consent_attestation is required" }).describe("Must be true."),
  max_attempts: z.number().int().optional().describe("Default 3. Maximum 5."),
  max_minutes: z.number().int().optional().describe("Default 5. Maximum 60. The hold covers this many minutes."),
  callback_url: z.string().optional(),
  idempotencyKey: idempotencyField("Same value as the REST Idempotency-Key header."),
});

const validateInput = z.object({
  phone: z.string().optional(),
  extension: z.string().optional(),
  language: z.string().optional(),
  business_name: z.string().optional(),
  purpose: purpose.optional(),
  goal: z.string().max(4000).optional(),
  record_call: z.boolean().optional().describe("False or omit."),
  script_mode: scriptMode.optional(),
  script: z.string().optional(),
  instructions: z.string().optional(),
  questions: z.array(validateQuestion).max(20).optional(),
  allowed_disclosures: z.string().optional(),
  on_behalf_of: z.string().optional(),
  shareable_contact: z.string().optional(),
  deadline: z.string().optional(),
  time_window: z.string().optional().describe("HH:MM-HH:MM, 24-hour, end after start."),
  recipient_timezone: z.string().optional(),
  retry_preference: z.any().optional(),
  allow_outside_business_hours: z.boolean().optional(),
  consent_attestation: z.boolean().optional(),
  max_attempts: z.number().int().optional(),
  max_minutes: z.number().int().optional(),
  callback_url: z.string().optional(),
});

const updateInput = z.object({
  call_id: callIdField(),
  phone: z.string().optional(),
  extension: z.string().optional().describe("Optional digits. Passed into the VA instructions."),
  language: z.string().optional(),
  business_name: z.string().optional(),
  purpose: z.string().optional(),
  goal: z.string().optional(),
  record_call: z.boolean().optional(),
  script_mode: z.string().optional(),
  script: z.string().optional(),
  instructions: z.string().optional(),
  questions: z.array(z.any()).optional(),
  allowed_disclosures: z.string().optional(),
  on_behalf_of: z.string().optional(),
  shareable_contact: z.string().optional(),
  deadline: z.string().optional(),
  time_window: z.string().optional(),
  recipient_timezone: z.string().optional(),
  retry_preference: z.any().optional(),
  allow_outside_business_hours: z.boolean().optional().describe(OUTSIDE_HOURS),
  consent_attestation: z.boolean().optional(),
  max_attempts: z.number().int().optional(),
  max_minutes: z.number().int().optional(),
  callback_url: z.string().optional(),
});

const callIdInput = z.object({
  call_id: callIdField(),
});

const PLACE_BODY_KEYS = [
  "phone",
  "extension",
  "language",
  "business_name",
  "purpose",
  "goal",
  "script_mode",
  "script",
  "instructions",
  "questions",
  "allowed_disclosures",
  "on_behalf_of",
  "shareable_contact",
  "deadline",
  "time_window",
  "recipient_timezone",
  "retry_preference",
  "allow_outside_business_hours",
  "consent_attestation",
  "max_attempts",
  "max_minutes",
  "callback_url",
] as const;

export type TaskbulletServerOptions = Omit<ApiClientOptions, "userAgent"> & {
  sourceAgent?: string;
  /** Shared client. HTTP mode reuses one client so the rate limit spans requests. */
  client?: ApiClient;
};

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function toolSuccess(schema: z.ZodTypeAny, body: unknown): CallToolResult {
  if (typeof body === "string") {
    return { content: [{ type: "text", text: body }] };
  }
  const text = JSON.stringify(body, null, 2);
  let structured: Record<string, unknown> = {};
  if (body && typeof body === "object" && !Array.isArray(body) && schema.safeParse(body).success) {
    structured = body as Record<string, unknown>;
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join("\n");
  if (typeof value === "object") return Object.values(value).map(collectText).filter(Boolean).join("\n");
  return "";
}

function blockSecrets(apiKey: string, ...parts: unknown[]): CallToolResult | null {
  const secret = findSecret(parts.map(collectText).filter(Boolean).join("\n"), apiKey);
  if (!secret) return null;
  return toolError(
    `Refusing to send this request because it contains ${secret}. Remove passwords, OTP codes, recovery keys, cookies, and API keys. Nothing was sent.`,
  );
}

function blockRecording(recordCall: boolean | undefined): CallToolResult | null {
  if (recordCall !== true) return null;
  return toolError("Recording is not available. record_call must be false or omitted. Nothing was sent.");
}

function idempotencyProblem(key: string): CallToolResult | null {
  if (key.length === 0 || key.length > 255 || key.trim() !== key || /[\u0000-\u001f\u007f]/.test(key)) {
    return toolError(
      "idempotencyKey must be a single header line of 1 to 255 characters with no leading or trailing space. Nothing was sent.",
    );
  }
  return null;
}

function httpsProblem(value: string | undefined, label: string): CallToolResult | null {
  if (value === undefined) return null;
  try {
    if (new URL(value).protocol === "https:") return null;
  } catch {
    // fall through
  }
  return toolError(`${label} must be an https URL. Nothing was sent.`);
}

function definedFields(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}

function readOnly(title: string) {
  return { ...readOnlyAnnotations, title };
}

function writeTool(title: string, destructive: boolean) {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: true,
    openWorldHint: true,
  };
}

export function createTaskbulletServer(options: TaskbulletServerOptions): McpServer {
  const client =
    options.client ??
    createApiClient({
      ...options,
      userAgent: `taskbullet-mcp-server/${SERVER_VERSION}`,
    });
  const sourceAgent = (options.sourceAgent ?? "mcp-client").trim().slice(0, 80) || "mcp-client";

  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "TaskBullet",
      version: SERVER_VERSION,
      description: "Delegate tasks and US/CA phone calls an AI agent cannot finish to a human TaskBullet virtual assistant.",
      websiteUrl: "https://taskbullet.com",
      icons: [...ICONS],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get balance",
      description:
        "Return remaining VA hours, capRoom, and whether a new cap can be filed. Also returns the calls wallet: balance_cents is spendable after open holds, wallet_cents is that amount plus holds_cents, and holds_cents is the sum of unsettled holds. addFundsUrl is POST /api/v1/billing/add-funds and this read does not create a Stripe session. canDelegate is false when hours are unavailable, when spendable hours are not above zero, or when open caps leave no room. canDelegate false while hoursRemaining is above zero means lower maxHours to capRoom or wait. It is not a buy-hours signal. Call this before proposing spend. Does not create a task.",
      inputSchema: z.object({}),
      outputSchema: balanceOutput,
      annotations: readOnly("Get balance"),
    },
    async () => {
      const result = await client.request("/balance");
      if (!result.ok) return toolError(result.message);
      return toolSuccess(balanceOutput, result.body);
    },
  );

  server.registerTool(
    "delegate_task",
    {
      title: "Delegate task",
      description:
        "Call get_balance first, then confirm with the user before sending (real hours) unless they already said to send it. Delegate a task to a real human virtual assistant when the AI cannot complete it autonomously. Use this for phone calls, owner-authorized login or captcha steps (never send passwords or OTP), physical-world actions, subjective QA, manual data entry, or anything else outside the model's reach. Returns a taskId for tracking. The job is NOT started until the customer clicks Start on Work. The receipt status is awaiting_customer_start.",
      inputSchema: delegateInput,
      outputSchema: delegateOutput,
      annotations: writeTool("Delegate task", true),
    },
    async (args) => {
      const blocked = blockSecrets(
        client.apiKey,
        args.title,
        args.description,
        args.dueDate,
        args.sourceAgent,
        args.webhookUrl,
        args.idempotencyKey,
      );
      if (blocked) return blocked;
      const keyError = idempotencyProblem(args.idempotencyKey);
      if (keyError) return keyError;
      if (!args.title.trim()) return toolError("title is required. Nothing was sent.");

      const payload: Record<string, unknown> = {
        title: args.title,
        sourceAgent: (args.sourceAgent?.trim() || sourceAgent).slice(0, 80) || "mcp-client",
        priority: args.priority,
      };
      if (args.description) payload.description = args.description;
      if (args.dueDate) payload.dueDate = args.dueDate;
      if (args.webhookUrl) payload.webhookUrl = args.webhookUrl;
      if (args.maxHours !== undefined) payload.maxHours = args.maxHours;

      const result = await client.request("/delegate", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": args.idempotencyKey },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(delegateOutput, result.body);
    },
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List delegated tasks",
      description:
        "List recently delegated tasks for this account (id, title, status, short result). awaitingCustomerConfirm true means the delivery is done and the human must confirm, cancel, or reopen. amNote is the delivery note and deliverableLinks are https links from that note. pending and in_progress omit customer-cancelled jobs. cancelled is terminal.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: readOnly("List delegated tasks"),
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.status !== "all") params.set("status", args.status);
      const qs = params.toString();
      const result = await client.request(qs ? `/tasks?${qs}` : "/tasks");
      if (!result.ok) return toolError(result.message);
      return toolSuccess(listOutput, result.body);
    },
  );

  server.registerTool(
    "get_task",
    {
      title: "Get delegated task",
      description:
        "Get the current status, title, completion timestamp, and full result notes for a specific delegated task. awaitingCustomerConfirm true means ask the human, then confirm_task, cancel_task, or reopen_task. amNote is the AM or VA note. deliverableLinks lists https links. Stop when status is completed, failed, or cancelled. Customer cancel is cancelled, not pending or in_progress, and it does not send the completion webhook.",
      inputSchema: getInput,
      outputSchema: taskOutput,
      annotations: readOnly("Get delegated task"),
    },
    async (args) => {
      const result = await client.request(`/tasks/${encodeURIComponent(args.taskId)}`);
      if (!result.ok) return toolError(result.message);
      return toolSuccess(taskOutput, result.body);
    },
  );

  server.registerTool(
    "confirm_task",
    {
      title: "Confirm task",
      description:
        "Accept a delivery that is awaitingCustomerConfirm. Settles tracked hours, releases the board and ledger hold, and marks the task completed. If the human does not respond, the job confirms itself after 3 days. Ask the human first. Idempotency-Key is required. A repeat of the same key returns the same result.",
      inputSchema: confirmInput,
      outputSchema: taskOutput,
      annotations: writeTool("Confirm task", true),
    },
    async (args) => {
      const blocked = blockSecrets(client.apiKey, args.idempotencyKey);
      if (blocked) return blocked;
      const keyError = idempotencyProblem(args.idempotencyKey);
      if (keyError) return keyError;
      const result = await client.request(`/tasks/${encodeURIComponent(args.taskId)}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": args.idempotencyKey },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(taskOutput, result.body);
    },
  );

  server.registerTool(
    "cancel_task",
    {
      title: "Cancel task",
      description:
        "Customer never mind. Releases the hold and bills only tracked time. Does not send the completion webhook. Ask the human first. Idempotency-Key is required.",
      inputSchema: cancelTaskInput,
      outputSchema: taskOutput,
      annotations: writeTool("Cancel task", true),
    },
    async (args) => {
      const blocked = blockSecrets(client.apiKey, args.reason, args.idempotencyKey);
      if (blocked) return blocked;
      const keyError = idempotencyProblem(args.idempotencyKey);
      if (keyError) return keyError;
      const result = await client.request(`/tasks/${encodeURIComponent(args.taskId)}/cancel`, {
        method: "POST",
        body: args.reason === undefined ? undefined : { reason: args.reason },
        headers: { "Idempotency-Key": args.idempotencyKey },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(taskOutput, result.body);
    },
  );

  server.registerTool(
    "reopen_task",
    {
      title: "Reopen task",
      description:
        "Send a delivery that is awaitingCustomerConfirm back to the account manager with a reason. Does not settle hours. Ask the human first. Idempotency-Key is required.",
      inputSchema: reopenInput,
      outputSchema: taskOutput,
      annotations: writeTool("Reopen task", false),
    },
    async (args) => {
      const blocked = blockSecrets(client.apiKey, args.reason, args.idempotencyKey);
      if (blocked) return blocked;
      const keyError = idempotencyProblem(args.idempotencyKey);
      if (keyError) return keyError;
      if (args.reason.trim().length < 3) {
        return toolError("reason must be at least 3 characters. Nothing was sent.");
      }
      const result = await client.request(`/tasks/${encodeURIComponent(args.taskId)}/reopen`, {
        method: "POST",
        body: { reason: args.reason },
        headers: { "Idempotency-Key": args.idempotencyKey },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(taskOutput, result.body);
    },
  );

  server.registerTool(
    "place_call",
    {
      title: "Place call",
      description:
        'Place one human phone call. The hold is the full call: the tier minimum for the first minute, then the per-minute rate for each additional minute. Default max_minutes is 5, so a tier 1 US or Canada call holds $6.50. Raise max_minutes on that call to hold more. record_call must be false or omitted. Only US and CA are live. A question is {"id","ask","type"?}: id up to 80 characters, ask up to 1000 characters, at most 20 questions. goal is at most 4000 characters. Idempotency key is required. Poll get_call, or pass callback_url. validate_call checks the body and places no hold.',
      inputSchema: placeInput,
      outputSchema: jsonOutput,
      annotations: writeTool("Place call", true),
    },
    async (args) => {
      const recording = blockRecording(args.record_call);
      if (recording) return recording;
      const blocked = blockSecrets(client.apiKey, definedFields(args, PLACE_BODY_KEYS), args.idempotencyKey);
      if (blocked) return blocked;
      const keyError = idempotencyProblem(args.idempotencyKey);
      if (keyError) return keyError;
      if (args.consent_attestation !== true) {
        return toolError("consent_attestation must be true. Nothing was sent.");
      }
      const callback = httpsProblem(args.callback_url, "callback_url");
      if (callback) return callback;
      const result = await client.request("/calls", {
        method: "POST",
        body: definedFields(args, PLACE_BODY_KEYS),
        headers: { "Idempotency-Key": args.idempotencyKey },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  server.registerTool(
    "validate_call",
    {
      title: "Validate call",
      description:
        "Check a phone-call body without creating a call or placing a hold. Same fields as place_call, without idempotencyKey. A ready body includes hold_cents for the full call (tier 1 default $6.50 at 5 minutes) and whether recipient_timezone was inferred. valid stays true when spendable balance is below the hold. warnings then includes insufficient_balance with needed_cents and addFundsUrl.",
      inputSchema: validateInput,
      outputSchema: jsonOutput,
      annotations: readOnly("Validate call"),
    },
    async (args) => {
      const recording = blockRecording(args.record_call);
      if (recording) return recording;
      const blocked = blockSecrets(client.apiKey, definedFields(args, PLACE_BODY_KEYS));
      if (blocked) return blocked;
      const callback = httpsProblem(args.callback_url, "callback_url");
      if (callback) return callback;
      const result = await client.request("/calls/validate", {
        method: "POST",
        body: definedFields(args, PLACE_BODY_KEYS),
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  server.registerTool(
    "get_call",
    {
      title: "Get call",
      description: "Read one human phone call, including needs_info missing_fields or the final result.",
      inputSchema: callIdInput,
      outputSchema: jsonOutput,
      annotations: readOnly("Get call"),
    },
    async (args) => {
      const result = await client.request(`/calls/${encodeURIComponent(args.call_id)}`);
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  server.registerTool(
    "update_call",
    {
      title: "Update call",
      description: "Fill missing_fields on a call in needs_info. Same result shapes as place_call.",
      inputSchema: updateInput,
      outputSchema: jsonOutput,
      annotations: writeTool("Update call", false),
    },
    async (args) => {
      const recording = blockRecording(args.record_call);
      if (recording) return recording;
      const blocked = blockSecrets(client.apiKey, definedFields(args, PLACE_BODY_KEYS));
      if (blocked) return blocked;
      const callback = httpsProblem(args.callback_url, "callback_url");
      if (callback) return callback;
      const result = await client.request(`/calls/${encodeURIComponent(args.call_id)}`, {
        method: "PATCH",
        body: definedFields(args, PLACE_BODY_KEYS),
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  server.registerTool(
    "cancel_call",
    {
      title: "Cancel call",
      description: "Cancel a call. Status stays cancel_pending until ops confirms. A confirm before any dial refunds the hold and the status becomes cancelled. If the dial already started, the error is cancel_too_late and the call bills normally. A dial after a confirmed cancel is a full refund and the VA is unpaid.",
      inputSchema: callIdInput,
      outputSchema: jsonOutput,
      annotations: writeTool("Cancel call", true),
    },
    async (args) => {
      const result = await client.request(`/calls/${encodeURIComponent(args.call_id)}/cancel`, { method: "POST" });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Get transcript",
      description: "Read the VA wrap-up summary for one call. This is not a recording. Once the call is wrap_up or completed, the result is that summary plus any question answers, with source wrap_up_summary and recorded false. Before a wrap-up summary exists, the result is transcript_not_ready. A call that ended without a dial (system failure or refund) is \"no transcript: call not placed\". A cancel after the dial started is call_cancelled. A recorded transcript may be a separate paid feature later and is not returned.",
      inputSchema: callIdInput,
      annotations: readOnly("Get transcript"),
    },
    async (args) => {
      const result = await client.request(`/calls/${encodeURIComponent(args.call_id)}/transcript.txt`, {
        headers: { accept: "text/plain, application/json" },
      });
      if (!result.ok) return toolError(result.message);
      return toolSuccess(jsonOutput, result.body);
    },
  );

  return server;
}
