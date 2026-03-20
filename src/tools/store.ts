import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import { ResponseFormatSchema } from "../schemas/common.js";
import type { Category } from "../types.js";

export function registerStoreTools(server: McpServer): void {

  // ─── List Categories ──────────────────────────────────────────────
  server.registerTool(
    "blanxer_list_categories",
    {
      title: "List Categories",
      description: `List all product categories in your Blanxer store.

Returns category IDs and names. Use category names when creating/updating products.`,
      inputSchema: ResponseFormatSchema.strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const categories = await apiRequest<Category[]>(`category/${storeId}`);

        if (!categories.length) {
          return { content: [{ type: "text", text: "No categories found." }] };
        }

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(categories, null, 2) }] };
        }

        const lines = [`# Categories (${categories.length})`, ""];
        for (const c of categories) {
          lines.push(`- **${c.name}** — ID: ${c._id}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Update Store Plugin ──────────────────────────────────────────
  server.registerTool(
    "blanxer_update_store_plugin",
    {
      title: "Update Store Plugin",
      description: `Update a store plugin setting (meta tag or Facebook Pixel). One plugin field per call.

Args:
  - plugin_type ('meta_tag' | 'fb_pixel'): Which plugin to update
  - value (string): Meta tag HTML string, or Facebook Pixel ID

Examples:
  - Set FB Pixel: plugin_type='fb_pixel', value='123456789'
  - Set meta tag: plugin_type='meta_tag', value='<meta name="description" content="...">'`,
      inputSchema: z.object({
        plugin_type: z.enum(["meta_tag", "fb_pixel"]).describe("Plugin type to update"),
        value: z.string().min(1).describe("Plugin value (pixel ID or meta tag HTML)"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        await apiRequest<unknown>(`store/${storeId}/update_plugin`, "POST", {
          [params.plugin_type]: params.value,
        });
        return { content: [{ type: "text", text: `Store plugin '${params.plugin_type}' updated successfully.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
