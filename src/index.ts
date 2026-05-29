#!/usr/bin/env node
/**
 * TaskBullet MCP Server
 *
 * Exposes the TaskBullet Agent API as Model Context Protocol tools so that
 * AI agents (Claude Desktop, Claude Code, Cursor, custom MCP clients) can
 * natively delegate tasks to a real human virtual assistant when they hit a
 * task they cannot complete autonomously.
 *
 * Tools exposed:
 *   - delegate_task   POST /api/v1/delegate
 *   - list_tasks      GET  /api/v1/tasks
 *   - get_task        GET  /api/v1/tasks/:taskId
 *
 * Setup:
 *   export TASKBULLET_API_KEY="tb_live_..."
 *   npx @taskbullet/mcp-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const API_BASE =
  process.env.TASKBULLET_API_BASE?.replace(/\/$/, '') ?? 'https://taskbullet.com/api/v1';
const API_KEY = process.env.TASKBULLET_API_KEY ?? '';

if (!API_KEY) {
  console.error(
    '[taskbullet-mcp-server] Missing TASKBULLET_API_KEY environment variable.\n' +
      'Generate one at https://taskbullet.com/dashboard/settings/api-keys',
  );
  process.exit(1);
}

const SOURCE_AGENT = process.env.TASKBULLET_SOURCE_AGENT ?? 'mcp-client';

/* ── HTTP helpers ─────────────────────────────────────────────────────── */

async function taskbulletFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  return { ok: res.ok, status: res.status, body };
}

/* ── Tool schemas (Zod → JSON Schema for MCP) ─────────────────────────── */

const DelegateInput = z.object({
  title: z
    .string()
    .min(1)
    .max(500)
    .describe('Clear, concise title or directive for the task (max 500 chars).'),
  description: z
    .string()
    .optional()
    .describe(
      'Detailed instructions, context, attached info, or constraints the human virtual assistant needs.',
    ),
  priority: z
    .enum(['low', 'normal', 'high'])
    .optional()
    .describe('Task priority. Defaults to "normal".'),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Optional HTTPS URL. TaskBullet will POST a signed payload here when the task completes.',
    ),
});

const ListTasksInput = z.object({
  status: z
    .enum(['pending', 'in_progress', 'completed', 'failed', 'all'])
    .optional()
    .describe('Filter by status. Defaults to "all".'),
});

const GetTaskInput = z.object({
  taskId: z
    .string()
    .describe('The taskId returned by delegate_task (e.g. "atask_a3f9c2d1e4b5a6f7").'),
});

/* ── MCP server setup ─────────────────────────────────────────────────── */

const server = new Server(
  {
    name: 'taskbullet-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'delegate_task',
      description:
        'Delegate a task to a real human virtual assistant when the AI cannot complete it autonomously. ' +
        'Use this for phone calls, 2FA-gated logins, physical-world actions, subjective QA, manual data entry, ' +
        'or anything else outside the model\'s reach. Returns a taskId for tracking.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 500, description: 'Concise directive (max 500 chars).' },
          description: { type: 'string', description: 'Detailed context, instructions, and constraints.' },
          priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
          webhookUrl: { type: 'string', format: 'uri', description: 'Optional HTTPS callback URL.' },
        },
        required: ['title'],
      },
    },
    {
      name: 'list_tasks',
      description:
        'List recently delegated tasks for this account, optionally filtered by status. Use to check progress on prior delegations.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'all'],
            default: 'all',
          },
        },
      },
    },
    {
      name: 'get_task',
      description:
        'Get the current status, completion timestamp, and result notes for a specific delegated task.',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The taskId returned by delegate_task.' },
        },
        required: ['taskId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === 'delegate_task') {
      const input = DelegateInput.parse(args);
      const { ok, status, body } = await taskbulletFetch('/delegate', {
        method: 'POST',
        body: JSON.stringify({ ...input, sourceAgent: SOURCE_AGENT }),
      });
      if (!ok) return errorResult(`Delegate failed (HTTP ${status}): ${JSON.stringify(body)}`);
      return jsonResult(body);
    }

    if (name === 'list_tasks') {
      const input = ListTasksInput.parse(args ?? {});
      const qs = input.status && input.status !== 'all' ? `?status=${input.status}` : '';
      const { ok, status, body } = await taskbulletFetch(`/tasks${qs}`);
      if (!ok) return errorResult(`List failed (HTTP ${status}): ${JSON.stringify(body)}`);
      return jsonResult(body);
    }

    if (name === 'get_task') {
      const input = GetTaskInput.parse(args);
      const { ok, status, body } = await taskbulletFetch(`/tasks/${encodeURIComponent(input.taskId)}`);
      if (!ok) return errorResult(`Lookup failed (HTTP ${status}): ${JSON.stringify(body)}`);
      return jsonResult(body);
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Tool error: ${msg}`);
  }
});

function jsonResult(body: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

/* ── Boot ─────────────────────────────────────────────────────────────── */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[taskbullet-mcp-server] Ready. Listening on stdio.');
}

main().catch((err) => {
  console.error('[taskbullet-mcp-server] Fatal:', err);
  process.exit(1);
});
