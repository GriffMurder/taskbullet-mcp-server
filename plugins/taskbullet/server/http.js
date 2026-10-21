/**
 * Optional streamable HTTP transport.
 * Stdio remains the default. Loopback binds do not need a token. Any other
 * host refuses to start unless TASKBULLET_HTTP_TOKEN is set, because the
 * process holds the TaskBullet API key.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApiClient, MAX_BODY_BYTES, redact, SlidingWindowLimiter } from "./client.js";
import { createTaskbulletServer } from "./server.js";
import { SERVER_VERSION } from "./version.js";
const PROTOCOL_VERSION = "2025-11-25";
export function isLoopbackHost(host) {
    const normalized = host.trim().toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}
export function assertHttpBindAllowed(host, token) {
    if (!isLoopbackHost(host) && !token) {
        throw new Error("Refusing to listen on a non-loopback address without TASKBULLET_HTTP_TOKEN. Set it in the Claude plugin's userConfig prompt, or in the environment for npm/Cursor. The API key stays in this process and must not be exposed on the network.");
    }
}
export function parsePort(value, fallback) {
    if (value === undefined || value === "")
        return fallback;
    if (!/^\d+$/.test(value))
        throw new Error("Port must be an integer.");
    const port = Number(value);
    if (port > 65535)
        throw new Error("Port must be between 0 and 65535.");
    return port;
}
function tokensMatch(expected, provided) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
function presentedToken(req) {
    const direct = req.headers["x-taskbullet-http-token"];
    if (typeof direct === "string" && direct.trim())
        return direct.trim();
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string")
        return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return match?.[1] ?? null;
}
function headerValue(value) {
    if (Array.isArray(value))
        return value[0];
    return value;
}
function sendJson(res, status, body, extra = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "content-length": Buffer.byteLength(payload),
        ...extra,
    });
    res.end(payload);
}
function rpcError(res, status, code, message, extra) {
    sendJson(res, status, { jsonrpc: "2.0", id: null, error: { code, message } }, extra);
}
function safeOrigin(origin, allowed) {
    if (!origin || /[\r\n]/.test(origin) || !allowed.has(origin))
        return undefined;
    return origin;
}
export async function startHttpServer(options) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 3000;
    const token = options.token?.trim() || undefined;
    assertHttpBindAllowed(host, token);
    const loopback = isLoopbackHost(host);
    const apiKey = options.apiKey;
    const log = (line) => {
        const emit = options.log ?? ((entry) => console.error(entry));
        emit(redact(`[taskbullet-mcp-server] ${line}`, [apiKey, token ?? ""]));
    };
    const client = createApiClient({
        ...options,
        userAgent: `taskbullet-mcp-server/${SERVER_VERSION}`,
    });
    const httpLimiter = options.httpRateLimit === null
        ? null
        : new SlidingWindowLimiter(options.httpRateLimit?.limit ?? 60, options.httpRateLimit?.windowMs ?? 60_000);
    let allowedOrigins = new Set();
    let boundPort = port;
    const httpServer = createServer((req, res) => {
        void handle(req, res).catch((err) => {
            const message = err instanceof Error ? err.message : "Internal error";
            log(message);
            if (!res.headersSent)
                rpcError(res, 500, -32603, "Internal error");
            else
                res.end();
        });
    });
    function cors(origin) {
        const echoed = safeOrigin(origin, allowedOrigins);
        if (!echoed)
            return {};
        return {
            "access-control-allow-origin": echoed,
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "Content-Type, Accept, Authorization, x-taskbullet-http-token, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
            "access-control-max-age": "600",
            vary: "Origin",
        };
    }
    async function handle(req, res) {
        const origin = headerValue(req.headers.origin);
        const extra = cors(origin);
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname !== "/mcp") {
            rpcError(res, 404, -32000, "Not found. The MCP endpoint is /mcp.", extra);
            return;
        }
        if (origin && !safeOrigin(origin, allowedOrigins)) {
            log("rejected origin");
            rpcError(res, 403, -32000, "Origin is not allowed.", extra);
            return;
        }
        if (loopback) {
            const hostHeader = headerValue(req.headers.host)?.trim().toLowerCase();
            const allowedHosts = new Set([
                `127.0.0.1:${boundPort}`,
                `localhost:${boundPort}`,
                `[::1]:${boundPort}`,
            ]);
            if (!hostHeader || !allowedHosts.has(hostHeader)) {
                log("rejected host");
                rpcError(res, 403, -32000, "Host is not allowed.", extra);
                return;
            }
        }
        if (req.method === "OPTIONS") {
            res.writeHead(204, extra);
            res.end();
            return;
        }
        const remote = req.socket.remoteAddress ?? "unknown";
        if (httpLimiter) {
            const slot = httpLimiter.take();
            if (!slot.ok) {
                log(`http rate limit ${remote}`);
                rpcError(res, 429, -32000, `Rate limit exceeded. Retry after ${slot.retryAfterSeconds} seconds.`, {
                    ...extra,
                    "retry-after": String(slot.retryAfterSeconds),
                });
                return;
            }
        }
        if (token) {
            const presented = presentedToken(req);
            if (!presented || !tokensMatch(token, presented)) {
                log("rejected http token");
                rpcError(res, 401, -32001, "Unauthorized: missing or invalid TASKBULLET_HTTP_TOKEN.", extra);
                return;
            }
        }
        if (req.method === "GET") {
            // This server does not push server-initiated messages. Spec: return 405
            // instead of holding an SSE stream open.
            rpcError(res, 405, -32000, "Method Not Allowed. This server does not offer an SSE stream.", {
                ...extra,
                allow: "POST, OPTIONS",
            });
            return;
        }
        if (req.method === "DELETE") {
            rpcError(res, 405, -32000, "Method Not Allowed. This server does not use sessions.", {
                ...extra,
                allow: "POST, OPTIONS",
            });
            return;
        }
        if (req.method !== "POST") {
            rpcError(res, 405, -32000, "Method Not Allowed.", { ...extra, allow: "POST, OPTIONS" });
            return;
        }
        const declared = headerValue(req.headers["content-length"]);
        if (declared && Number(declared) > MAX_BODY_BYTES) {
            rpcError(res, 413, -32000, "Request body is larger than 32 KiB.", extra);
            return;
        }
        const mcp = createTaskbulletServer({ ...options, client });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            maxRequestBodySize: MAX_BODY_BYTES,
        });
        transport.onerror = (error) => log(error.message);
        let closed = false;
        const shutdown = () => {
            if (closed)
                return;
            closed = true;
            void transport.close();
            void mcp.close();
        };
        res.on("close", shutdown);
        try {
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
        }
        finally {
            shutdown();
        }
    }
    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
            const address = httpServer.address();
            boundPort = typeof address === "object" && address ? address.port : port;
            const origins = [
                `http://127.0.0.1:${boundPort}`,
                `http://localhost:${boundPort}`,
                `http://[::1]:${boundPort}`,
                ...(options.allowedOrigins ?? []),
            ];
            allowedOrigins = new Set(origins.filter((item) => item.trim() && !/[\r\n]/.test(item)));
            resolve();
        });
    });
    const url = `http://${host === "::1" ? "[::1]" : host}:${boundPort}/mcp`;
    return {
        url,
        port: boundPort,
        close: () => new Promise((resolve, reject) => {
            httpServer.close((err) => (err ? reject(err) : resolve()));
            httpServer.closeAllConnections?.();
        }),
    };
}
