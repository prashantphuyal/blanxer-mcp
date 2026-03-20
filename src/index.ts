#!/usr/bin/env node
/**
 * Blanxer Ecommerce MCP Server
 *
 * Two deployment modes:
 *
 * 1. LOCAL (stdio) — single store, for Claude Code / Claude Desktop
 *    BLANXER_API_KEY=sk_xxx node dist/index.js
 *
 * 2. PUBLIC (http) — multi-tenant, each agent passes their own API key
 *    TRANSPORT=http PORT=3000 node dist/index.js
 *    Agents connect via: https://your-server.com/mcp
 *    With header: X-Blanxer-Api-Key: sk_xxx
 *    (or Authorization: Bearer sk_xxx)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";

import { initAuth, resolveAuth, runWithAuth, getDefaultAuth } from "./services/api.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/products.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerSmsTools } from "./tools/sms.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerStoreTools } from "./tools/store.js";

// ─── Build MCP server (tools are stateless — auth via AsyncLocalStorage) ──────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "blanxer-ecommerce-mcp-server",
    version: "1.0.0",
  });

  registerOrderTools(server);
  registerProductTools(server);
  registerInventoryTools(server);
  registerSmsTools(server);
  registerAnalyticsTools(server);
  registerStoreTools(server);

  return server;
}

// ─── stdio (local single-tenant) ─────────────────────────────────────────────

async function runStdio(): Promise<void> {
  if (!process.env.BLANXER_API_KEY) {
    console.error("ERROR: BLANXER_API_KEY environment variable is required");
    process.exit(1);
  }

  const auth = await initAuth();
  console.error(`[blanxer-mcp] Connected as: ${auth.storeName} (${auth.storeId})`);

  const server = createMcpServer();

  // Wrap the stdio connection in the auth context so all tool calls resolve it
  runWithAuth(auth, async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[blanxer-mcp] Running via stdio");
  });
}

// ─── HTTP (public multi-tenant) ───────────────────────────────────────────────

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Optional: protect with a static access token (set ACCESS_TOKEN env var)
  // Agents must send: Authorization: Bearer <ACCESS_TOKEN>
  // If not set, any request with a valid Blanxer API key can connect.
  const accessToken = process.env.ACCESS_TOKEN;

  // ── /health ──────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "blanxer-ecommerce-mcp-server",
      version: "1.0.0",
      mode: "multi-tenant HTTP",
    });
  });

  // ── /mcp ─────────────────────────────────────────────────────────────────────
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // 1. Extract Blanxer API key
      //    Priority: X-Blanxer-Api-Key header > Authorization Bearer (if no ACCESS_TOKEN)
      let blanxerApiKey: string | undefined;

      const xHeader = req.headers["x-blanxer-api-key"];
      if (xHeader) {
        blanxerApiKey = Array.isArray(xHeader) ? xHeader[0] : xHeader;
      } else {
        const authHeader = req.headers["authorization"] ?? "";
        const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;

        if (accessToken) {
          // Protected mode: Authorization header is the ACCESS_TOKEN, not the API key
          if (bearer !== `Bearer ${accessToken}`) {
            res.status(401).json({ error: "Invalid access token" });
            return;
          }
          // Fall through to env var API key below
        } else {
          // Open mode: Authorization header IS the Blanxer API key
          blanxerApiKey = bearer.replace(/^Bearer\s+/i, "").trim() || undefined;
        }
      }

      // Fall back to env var (single-tenant / pre-configured store)
      if (!blanxerApiKey) {
        blanxerApiKey = process.env.BLANXER_API_KEY;
      }

      if (!blanxerApiKey) {
        res.status(401).json({
          error: "Blanxer API key required. Send it via X-Blanxer-Api-Key header or Authorization: Bearer <api_key>",
        });
        return;
      }

      // 2. Resolve auth (cached per API key)
      const auth = await resolveAuth(blanxerApiKey);

      // 3. Handle MCP request inside the auth context
      await runWithAuth(auth, async () => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        const server = createMcpServer();
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    } catch (err) {
      console.error("[blanxer-mcp] Request error:", err);
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(msg.includes("Invalid Blanxer API key") ? 401 : 500).json({ error: msg });
      }
    }
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`[blanxer-mcp] HTTP server on port ${port}`);
    console.error(`[blanxer-mcp] MCP endpoint: POST http://localhost:${port}/mcp`);
    if (accessToken) {
      console.error(`[blanxer-mcp] Protected mode: ACCESS_TOKEN is set`);
    } else {
      console.error(`[blanxer-mcp] Open mode: pass Blanxer API key via X-Blanxer-Api-Key or Authorization header`);
    }
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const transport = process.env.TRANSPORT ?? "stdio";

if (transport === "http") {
  runHTTP().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
