import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, CHARACTER_LIMIT } from "../constants.js";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import { ResponseFormatSchema } from "../schemas/common.js";
import type { Order, PrintRequestResponse } from "../types.js";

const ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"] as const;

export function registerOrderTools(server: McpServer): void {

  // ─── List Orders ──────────────────────────────────────────────────
  server.registerTool(
    "blanxer_list_orders",
    {
      title: "List Orders",
      description: `List orders from your Blanxer store with optional filters.

Args:
  - status: Filter by order status (Pending|Processing|Shipped|Delivered|Cancelled|Returned)
  - from: Start date filter in ISO 8601 format (e.g. 2026-01-01). Max 30-day range recommended.
  - to: End date filter in ISO 8601 format (e.g. 2026-01-31)
  - label: Optional label filter
  - response_format: 'markdown' or 'json'

Returns array of orders with customer info, product totals, payment details.`,
      inputSchema: ResponseFormatSchema.extend({
        status: z.enum(ORDER_STATUSES).optional()
          .describe("Filter by order status"),
        from: z.string().optional()
          .describe("Start date ISO 8601 (e.g. 2026-01-01). Max 30-day range recommended."),
        to: z.string().optional()
          .describe("End date ISO 8601 (e.g. 2026-01-31)"),
        label: z.string().optional()
          .describe("Optional label filter"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const { response_format, ...filters } = params;
        const data = await apiRequest<{ orders: Order[] }>(
          `order/${storeId}`, "GET", undefined,
          Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined))
        );

        const orders = data.orders ?? [];
        if (!orders.length) {
          return { content: [{ type: "text", text: "No orders found for the given filters." }] };
        }

        if (response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify({ orders, count: orders.length }, null, 2) }] };
        }

        const lines = [`# Orders (${orders.length} found)`, ""];
        for (const o of orders) {
          lines.push(`## #${o.order_number}`);
          lines.push(`- **Customer**: ${o.customer_full_name} | ${o.customer_phone_number} | ${o.customer_address_city}`);
          lines.push(`- **Status**: ${o.status} | **Payment**: ${o.payment_status} (${o.payment_method})`);
          lines.push(`- **Total**: Rs ${o.cod_amount} (Products: Rs ${o.product_total_price} + Delivery: Rs ${o.delivery_charge})`);
          lines.push(`- **Date**: ${o.created_at}`);
          if (o.ordered_products?.length) {
            lines.push(`- **Items**: ${o.ordered_products.map(p => `${p.product_name} ×${p.quantity}`).join(", ")}`);
          }
          lines.push("");
        }

        const text = lines.join("\n");
        return { content: [{ type: "text", text: text.length > CHARACTER_LIMIT ? text.slice(0, CHARACTER_LIMIT) + "\n_[truncated — narrow date range or add status filter]_" : text }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Get Order Details ────────────────────────────────────────────
  server.registerTool(
    "blanxer_get_order",
    {
      title: "Get Order Details",
      description: `Get full details of a single order by its ID.

Args:
  - order_id (string): The order's _id (not order_number)
  - response_format: Output format

Returns complete order object with shipping, products, and payment details.`,
      inputSchema: ResponseFormatSchema.extend({
        order_id: z.string().describe("Order _id (MongoDB ObjectId, not order_number)"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const order = await apiRequest<Order>(`order/${storeId}/${params.order_id}`);

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
        }

        const lines = [
          `# Order #${order.order_number}`,
          `**ID**: ${order._id}`,
          "",
          `## Customer`,
          `- **Name**: ${order.customer_full_name}`,
          `- **Phone**: ${order.customer_phone_number}`,
          `- **City**: ${order.customer_address_city}`,
          "",
          `## Status`,
          `- **Order Status**: ${order.status}`,
          `- **Payment**: ${order.payment_status} via ${order.payment_method}`,
          "",
          `## Items`,
          ...(order.ordered_products?.map(p => `- ${p.product_name} × ${p.quantity} — Rs ${p.price}`) ?? []),
          "",
          `## Totals`,
          `- Products: Rs ${order.product_total_price}`,
          `- Delivery: Rs ${order.delivery_charge}`,
          `- **COD Amount: Rs ${order.cod_amount}**`,
          "",
          `_Created: ${order.created_at}_`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Create Pathao Shipment ───────────────────────────────────────
  server.registerTool(
    "blanxer_create_pathao_shipment",
    {
      title: "Create Pathao Shipment",
      description: `Create a Pathao delivery shipment for an order.

Args:
  - order_id (string): Order _id
  - recipient_name (string): Customer full name
  - recipient_phone (string): Customer phone (e.g. 9841234567)
  - recipient_address (string): Full delivery address
  - recipient_city (number): Pathao city ID
  - recipient_zone (number): Pathao zone ID
  - recipient_area (number): Pathao area ID
  - delivery_type (number): 48 = Normal delivery
  - item_type (number): 2 = Parcel
  - item_quantity (number): Total item count
  - item_weight (number): Weight in kg
  - amount_to_collect (number): COD amount to collect (0 for prepaid)

Returns Pathao shipment confirmation.`,
      inputSchema: z.object({
        order_id: z.string().describe("Order _id"),
        recipient_name: z.string().describe("Recipient full name"),
        recipient_phone: z.string().describe("Recipient phone number"),
        recipient_address: z.string().describe("Full delivery address"),
        recipient_city: z.number().int().describe("Pathao city ID"),
        recipient_zone: z.number().int().describe("Pathao zone ID"),
        recipient_area: z.number().int().describe("Pathao area ID"),
        delivery_type: z.number().int().default(48).describe("Delivery type (48=Normal)"),
        item_type: z.number().int().default(2).describe("Item type (2=Parcel)"),
        item_quantity: z.number().int().min(1).describe("Total item quantity"),
        item_weight: z.number().positive().describe("Weight in kg"),
        amount_to_collect: z.number().min(0).describe("COD amount (0 for prepaid)"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const { order_id, ...body } = params;
        const result = await apiRequest<unknown>(`order/${storeId}/${order_id}/pathao`, "POST", body);
        return { content: [{ type: "text", text: `Pathao shipment created for order ${order_id}.\n\n${JSON.stringify(result, null, 2)}` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Create Print Request ─────────────────────────────────────────
  server.registerTool(
    "blanxer_create_print_request",
    {
      title: "Create Print Request",
      description: `Create a bulk print request for order labels. Returns a print request ID.

Args:
  - order_ids (string[]): Array of order _ids to include in the print request

Returns print request ID which can be used with blanxer_get_print_request.`,
      inputSchema: z.object({
        order_ids: z.array(z.string()).min(1).describe("Array of order _ids to print"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const res = await apiRequest<PrintRequestResponse>(`order/print_request/${storeId}`, "POST", { order_ids: params.order_ids });
        return { content: [{ type: "text", text: `Print request created.\n- **Print Request ID**: ${res.id}\n- Orders included: ${params.order_ids.length}\n\nUse \`blanxer_get_print_request\` with ID \`${res.id}\` to fetch the print details.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Get Print Request ────────────────────────────────────────────
  server.registerTool(
    "blanxer_get_print_request",
    {
      title: "Get Print Request Details",
      description: `Fetch details of a previously created print request.

Args:
  - print_request_id (string): ID returned by blanxer_create_print_request

Returns print request details.`,
      inputSchema: z.object({
        print_request_id: z.string().describe("Print request ID from blanxer_create_print_request"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const result = await apiRequest<unknown>(`order/print_request/${storeId}/${params.print_request_id}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
