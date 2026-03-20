/**
 * Blanxer MCP Server — Cloudflare Workers entry point
 *
 * Agents connect via POST /mcp
 * Pass Blanxer API key as:  X-Blanxer-Api-Key: sk_xxx
 * Or as:                    Authorization: Bearer sk_xxx
 *
 * Optional: set ACCESS_TOKEN env var to require a static token for access control.
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveAuth, runWithAuth } from "./services/api.js";
import { WorkersHttpTransport } from "./transport/workers-http.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/products.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerSmsTools } from "./tools/sms.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerStoreTools } from "./tools/store.js";

interface Env {
  BLANXER_API_KEY?: string;
  ACCESS_TOKEN?: string;
}

// ─── Build MCP server ─────────────────────────────────────────────────────────

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

// ─── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.json({
    name: "Blanxer MCP Server",
    version: "1.0.0",
    endpoint: "/mcp",
    auth: "Pass your Blanxer API key via X-Blanxer-Api-Key header",
  })
);

app.get("/health", (c) =>
  c.json({ status: "ok", server: "blanxer-ecommerce-mcp-server", version: "1.0.0" })
);

app.post("/mcp", async (c) => {
  const env = c.env;

  // 1. Extract Blanxer API key
  // Priority: query param > X-Blanxer-Api-Key header > Authorization Bearer > env var
  let blanxerApiKey: string | undefined;

  const queryKey = c.req.query("api_key");
  if (queryKey) {
    blanxerApiKey = queryKey;
  } else if (c.req.header("x-blanxer-api-key")) {
    blanxerApiKey = c.req.header("x-blanxer-api-key");
  } else {
    const authHeader = c.req.header("authorization") ?? "";

    if (env.ACCESS_TOKEN) {
      // Protected mode: validate the static access token
      if (authHeader !== `Bearer ${env.ACCESS_TOKEN}`) {
        return c.json({ error: "Invalid access token" }, 401);
      }
      // Use env API key after access token validates
      blanxerApiKey = env.BLANXER_API_KEY;
    } else {
      // Open mode: Authorization header IS the Blanxer API key
      blanxerApiKey = authHeader.replace(/^Bearer\s+/i, "").trim() || env.BLANXER_API_KEY;
    }
  }

  if (!blanxerApiKey) {
    return c.json(
      { error: "Blanxer API key required. Send via X-Blanxer-Api-Key header or Authorization: Bearer <api_key>" },
      401
    );
  }

  // 2. Resolve auth (cached per API key within Worker instance)
  let auth;
  try {
    auth = await resolveAuth(blanxerApiKey);
  } catch {
    return c.json({ error: "Invalid Blanxer API key" }, 401);
  }

  // 3. Parse request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // 4. Process MCP request within auth context
  return new Promise<Response>((resolve) => {
    runWithAuth(auth, async () => {
      const transport = new WorkersHttpTransport();
      const server = createMcpServer();

      await server.connect(transport);

      try {
        const response = await transport.handleMessage(body);
        resolve(
          c.json(response, 200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve(c.json({ error: msg }, 500));
      } finally {
        await transport.close();
      }
    });
  });
});

// CORS preflight
app.options("/mcp", (c) => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Blanxer-Api-Key",
    },
  });
});

export default app;
