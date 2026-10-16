/**
 * TaskBullet MCP tools.
 * Names and required arguments match 0.1.x. New delegate_task fields are optional.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID as nodeRandomUUID } from "node:crypto";
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

Call get_balance before proposing spend. Confirm with the user before delegate_task (real hours, 15-minute rounding, maxHours defaults to 0.5 and caps at 8) unless they already said to send it. maxHours is a spend cap. Tracked time is what is billed.

HTTP 402 addHoursUrl is the buy page (${PACKAGES_URL}), not a new trial, and only when a live Ops read is not above zero. canDelegate false while hoursRemaining is above zero is not a buy-hours signal. A cap that does not fit open caps is HTTP 422 with hoursRemaining and capRoom: lower maxHours to capRoom or wait. HTTP 503 hoursUnavailable is not a buy-hours error.

A tb_live_ key files the brief. The customer starts VA hours on Work. awaiting_customer_start means the job is NOT started until the customer clicks Start. Do not say the VA has started. The calling model cannot confirm or close the job. Missing Basecamp queues the task and provisions the workspace.

When you cannot finish (phone calls, 2FA, captcha, physical-world steps, subjective QA, long manual work), use delegate_task. Poll get_task until status is completed, failed, or cancelled, or pass an https webhookUrl. Customer cancel is cancelled, not pending or in_progress, and it does not send the completion webhook. A VA checkbox does not complete the task. Never invent VA results.

Never put passwords, OTP codes, recovery keys, cookies, or API keys in delegate_task fields. Pass idempotencyKey to retry the same brief safely. If you omit it, a new key is generated for that call.

Named prospect, lead, or cold lists: https://taskbullet.com/build-a-list (pay once, CSV — not a scrape, not hours). After the file exists, calling it is last-mile delegate_task. An existing list skips the wizard.

Marketing and hire-intent routing is a different read-only server with no customer data: https://taskbullet.com/api/mcp.
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
  })
  .passthrough();

const delegateInput = z.object({
  title: z
    .string({ required_error: "title is required" })
    .min(1, "title is required")
    .max(5000, "title must be at most 5000 characters")
    .describe("Clear directive for the human VA. Max 5000 characters. No secrets."),
  description: z
    .string()
    .max(8000, "description must be at most 8000 characters")
    .optional()
    .describe("Instructions, context, and constraints. Max 8000 characters. No passwords, OTP codes, recovery keys, cookies, or API keys."),
  priority: z
    .enum(["low", "normal", "high", "urgent"])
    .optional()
    .describe('Task priority. Defaults to "normal" on the server when omitted. Unknown values are rejected.'),
  dueDate: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional human-readable due date or deadline."),
  webhookUrl: z
    .string()
    .max(2000)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "webhookUrl must be an https URL")
    .optional()
    .describe("Optional public https URL. TaskBullet POSTs a signed payload when the customer closes the job. A VA checkbox and a customer cancel do not send it."),
  maxHours: z
    .number()
    .min(0.01, "maxHours must be at least 0.01")
    .max(8, "maxHours must be at most 8")
    .optional()
    .describe("Spend cap in hours. Defaults to 0.5 when omitted. Maximum 8. Actual tracked time is billed, not this cap."),
  idempotencyKey: z
    .string()
    .min(1, "idempotencyKey must not be empty")
    .max(200, "idempotencyKey must be at most 200 characters")
    .regex(/^[A-Za-z0-9._:-]+$/, "idempotencyKey may contain only letters, numbers, and . _ : -")
    .optional()
    .describe("Optional. The same account and key returns the original task. Omit to generate a new key for this call."),
});

const listInput = z.object({
  status: z
    .enum(["pending", "in_progress", "completed", "failed", "cancelled", "all"])
    .optional()
    .describe('Filter by status. Defaults to "all". pending and in_progress omit customer-cancelled jobs.'),
});

const getInput = z.object({
  taskId: z
    .string({ required_error: "taskId is required" })
    .min(1, "taskId is required")
    .max(200, "taskId must be at most 200 characters")
    .refine((value) => !/[\s/\\]/.test(value) && !value.includes(".."), "taskId is invalid")
    .describe('The taskId returned by delegate_task (for example "atask_a3f9c2d1e4b5a6f7").'),
});

export type TaskbulletServerOptions = Omit<ApiClientOptions, "userAgent"> & {
  sourceAgent?: string;
  randomUUID?: () => string;
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
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  let structured: Record<string, unknown> = {};
  if (body && typeof body === "object" && !Array.isArray(body) && schema.safeParse(body).success) {
    structured = body as Record<string, unknown>;
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

export function createTaskbulletServer(options: TaskbulletServerOptions): McpServer {
  const client =
    options.client ??
    createApiClient({
      ...options,
      userAgent: `taskbullet-mcp-server/${SERVER_VERSION}`,
    });
  const sourceAgent = (options.sourceAgent ?? "mcp-client").trim().slice(0, 200) || "mcp-client";
  const randomUUID = options.randomUUID ?? nodeRandomUUID;

  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "TaskBullet",
      version: SERVER_VERSION,
      description: "Delegate tasks an AI agent cannot finish to a human TaskBullet virtual assistant.",
      websiteUrl: "https://taskbullet.com",
      icons: [...ICONS],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get hour balance",
      description:
        "Return remaining VA hours, capRoom, and whether a new delegate_task cap can be filed. Call this before proposing spend. canDelegate false while hoursRemaining is above zero means lower maxHours to capRoom or wait. It is not a buy-hours signal. HTTP 402 addHoursUrl is the packages page, and only when a live read is not above zero. Does not create a task.",
      inputSchema: z.object({}),
      outputSchema: balanceOutput,
      annotations: { ...readOnlyAnnotations, title: "Get hour balance" },
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
        "File a task for a human virtual assistant when you cannot finish it (phone, 2FA, captcha, physical world, subjective QA, long manual work). Call get_balance first and confirm with the user before sending unless they already said to send it. Real hours, 15-minute rounding. maxHours defaults to 0.5 (max 8) and is a spend cap, not a prepaid debit. A tb_live_ key files the brief. The customer starts VA hours on Work. awaiting_customer_start means the job is NOT started. Do not say the VA has started. Never include passwords, OTP codes, recovery keys, cookies, or API keys. Never invent VA results. Pass idempotencyKey to retry the same brief. The same key returns the original task.",
      inputSchema: delegateInput,
      outputSchema: delegateOutput,
      annotations: {
        title: "Delegate task",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const secret = findSecret(
        [args.title, args.description, args.dueDate, args.webhookUrl, args.idempotencyKey].filter(Boolean).join("\n"),
        client.apiKey,
      );
      if (secret) {
        return toolError(
          `Refusing to send this brief because it contains ${secret}. Remove passwords, OTP codes, recovery keys, cookies, and API keys. Nothing was sent.`,
        );
      }

      const idempotencyKey = args.idempotencyKey ?? randomUUID();
      const payload: Record<string, unknown> = { title: args.title, sourceAgent };
      if (args.description) payload.description = args.description;
      if (args.priority) payload.priority = args.priority;
      if (args.dueDate) payload.dueDate = args.dueDate;
      if (args.webhookUrl) payload.webhookUrl = args.webhookUrl;
      if (args.maxHours !== undefined) payload.maxHours = args.maxHours;

      const result = await client.request("/delegate", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": idempotencyKey },
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
        "List up to 50 recently delegated tasks. Optional status filter: pending, in_progress, completed, failed, cancelled, or all. pending and in_progress omit customer-cancelled jobs. Each row includes title and a short result when completed.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: { ...readOnlyAnnotations, title: "List delegated tasks" },
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.status && args.status !== "all") params.set("status", args.status);
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
        "Get status and the full result for one taskId. Stop when status is completed, failed, or cancelled. Customer cancel is cancelled, does not send the completion webhook, and is not pending or in_progress. A VA checkbox does not complete the task. Never invent a result.",
      inputSchema: getInput,
      outputSchema: taskOutput,
      annotations: { ...readOnlyAnnotations, title: "Get delegated task" },
    },
    async (args) => {
      const result = await client.request(`/tasks/${encodeURIComponent(args.taskId)}`);
      if (!result.ok) return toolError(result.message);
      return toolSuccess(taskOutput, result.body);
    },
  );

  return server;
}
