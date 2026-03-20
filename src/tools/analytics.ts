import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import { ResponseFormatSchema } from "../schemas/common.js";
import type { DashboardSummary, SalesAnalytics } from "../types.js";

export function registerAnalyticsTools(server: McpServer): void {

  // ─── Dashboard Summary ────────────────────────────────────────────
  server.registerTool(
    "blanxer_get_dashboard",
    {
      title: "Get Dashboard Summary",
      description: `Get today's store dashboard summary: order counts, revenue, and fulfillment status breakdown.

Returns today's orders, revenue, and counts for Pending/Processing/Delivered orders.`,
      inputSchema: ResponseFormatSchema.strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const data = await apiRequest<DashboardSummary>(`analytics/dashboard/${storeId}`);

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Dashboard — Today`,
          "",
          `- **Orders Today**: ${data.today_orders ?? "—"}`,
          `- **Revenue Today**: Rs ${data.today_revenue ?? "—"}`,
          "",
          `## Order Status Breakdown`,
          `- **Pending**: ${data.pending ?? "—"}`,
          `- **Processing**: ${data.processing ?? "—"}`,
          `- **Delivered**: ${data.delivered ?? "—"}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Sales Analytics ──────────────────────────────────────────────
  server.registerTool(
    "blanxer_get_sales_analytics",
    {
      title: "Get Sales Analytics",
      description: `Get detailed sales analytics for a date range.

Args:
  - from (string): Start date ISO 8601 (e.g. 2026-01-01)
  - to (string): End date ISO 8601 (e.g. 2026-01-31)
  - outlet (string): Outlet ID or 'all' (default 'all')
  - mode (number): Analytics mode (default 1)
  - response_format: Output format

Returns revenue, order count, average order value, top products, and daily breakdown.`,
      inputSchema: ResponseFormatSchema.extend({
        from: z.string().describe("Start date ISO 8601 (e.g. 2026-01-01)"),
        to: z.string().describe("End date ISO 8601 (e.g. 2026-01-31)"),
        outlet: z.string().default("all").describe("Outlet ID or 'all'"),
        mode: z.number().int().default(1).describe("Analytics mode (default 1)"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const data = await apiRequest<SalesAnalytics>(
          `analytics/${storeId}`, "GET", undefined,
          { outlet: params.outlet, mode: params.mode, from: params.from, to: params.to }
        );

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `# Sales Analytics: ${params.from} → ${params.to}`,
          "",
          `- **Revenue**: Rs ${data.revenue ?? "—"}`,
          `- **Orders**: ${data.orders ?? "—"}`,
          `- **Avg Order Value**: Rs ${data.avg_order_value ?? "—"}`,
        ];

        if (Array.isArray(data.top_products) && data.top_products.length) {
          lines.push("", "## Top Products");
          for (const p of data.top_products) {
            lines.push(`- ${JSON.stringify(p)}`);
          }
        }

        if (Array.isArray(data.daily_breakdown) && data.daily_breakdown.length) {
          lines.push("", "## Daily Breakdown");
          for (const d of data.daily_breakdown) {
            lines.push(`- ${JSON.stringify(d)}`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
