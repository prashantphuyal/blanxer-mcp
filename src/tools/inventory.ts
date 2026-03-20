import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import { ResponseFormatSchema } from "../schemas/common.js";
import type { Outlet } from "../types.js";

export function registerInventoryTools(server: McpServer): void {

  // ─── List Outlets ─────────────────────────────────────────────────
  server.registerTool(
    "blanxer_list_outlets",
    {
      title: "List Inventory Outlets",
      description: `List all inventory outlets (warehouses/locations) in your Blanxer store.

Returns outlet IDs, names, addresses, and which is default.
Use outlet _id when calling blanxer_stock_in.`,
      inputSchema: ResponseFormatSchema.strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const outlets = await apiRequest<Outlet[]>(`inventory/outlets/${storeId}`);

        if (!outlets.length) {
          return { content: [{ type: "text", text: "No outlets found." }] };
        }

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(outlets, null, 2) }] };
        }

        const lines = [`# Inventory Outlets (${outlets.length})`, ""];
        for (const o of outlets) {
          lines.push(`- **${o.name}** (${o._id})${o.is_default ? " ← default" : ""}`);
          lines.push(`  Address: ${o.address}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Stock In ─────────────────────────────────────────────────────
  server.registerTool(
    "blanxer_stock_in",
    {
      title: "Stock In",
      description: `Add incoming stock to a product at a specific outlet.

Args:
  - product_id (string): Product _id
  - outlet_id (string): Outlet _id (get from blanxer_list_outlets)
  - quantity (number): Units to add (must be positive)
  - variant_id (string): Variant _id (optional — only for products with variants)
  - note (string): Reason for stock-in (e.g. 'Restocked from supplier', 'Manual correction')

Returns confirmation.`,
      inputSchema: z.object({
        product_id: z.string().describe("Product _id"),
        outlet_id: z.string().describe("Outlet _id (from blanxer_list_outlets)"),
        quantity: z.number().int().positive().describe("Units to add (must be > 0)"),
        variant_id: z.string().optional().describe("Variant _id (only for products with variants)"),
        note: z.string().min(3).default("Manual stock-in").describe("Reason for stock-in"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const body: Record<string, unknown> = {
          store_id: storeId,
          product_id: params.product_id,
          outlet_id: params.outlet_id,
          quantity: params.quantity,
          note: params.note,
        };
        if (params.variant_id) body.variant_id = params.variant_id;

        await apiRequest<unknown>("inventory/stock-in", "POST", body);
        return {
          content: [{
            type: "text",
            text: `Stock-in recorded: +${params.quantity} units for product ${params.product_id} at outlet ${params.outlet_id}.\nNote: ${params.note}`,
          }]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
