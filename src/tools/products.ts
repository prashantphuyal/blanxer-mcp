import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat, CHARACTER_LIMIT } from "../constants.js";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import { ResponseFormatSchema } from "../schemas/common.js";
import type { Product, ProductVariant } from "../types.js";

function formatVariants(variants: ProductVariant[], currency = "NPR"): string[] {
  const lines: string[] = ["", "## Variants"];
  for (const v of variants) {
    const stock = v.quantity > 0 ? `${v.quantity} in stock` : "Out of stock";
    const compare = v.compare_at_price ? ` ~~Rs ${v.compare_at_price}~~` : "";
    lines.push(`- **${v.option_name}**: Rs ${v.price}${compare} | ${stock}${v.sku ? ` | SKU: ${v.sku}` : ""}${v.barcode ? ` | Barcode: ${v.barcode}` : ""} | ID: ${v._id}`);
  }
  return lines;
}

export function registerProductTools(server: McpServer): void {

  // ─── List Products (Authenticated — all statuses) ─────────────────
  server.registerTool(
    "blanxer_list_products",
    {
      title: "List All Products",
      description: `List all products in your Blanxer store (authenticated, includes drafts/inactive).

Args:
  - response_format: 'markdown' or 'json'

Returns full product list with price, stock, status, and categories.
Use blanxer_search_products to find specific products by keyword.`,
      inputSchema: ResponseFormatSchema.strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const products = await apiRequest<Product[]>(`product/${storeId}`);

        if (!products.length) {
          return { content: [{ type: "text", text: "No products found in the store." }] };
        }

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) }] };
        }

        const lines = [`# Products (${products.length} total)`, ""];
        for (const p of products) {
          const hasVariants = p.variants && p.variants.length > 0;
          const totalStock = hasVariants
            ? p.variants!.reduce((sum, v) => sum + v.quantity, 0)
            : p.quantity;
          const priceDisplay = hasVariants
            ? `Rs ${Math.min(...p.variants!.map(v => v.price))}–${Math.max(...p.variants!.map(v => v.price))}`
            : `Rs ${p.price}`;
          lines.push(`- **${p.name}** — ${priceDisplay} | ${totalStock} in stock | ${p.status} | ID: ${p._id}`);
          if (hasVariants) lines.push(`  Variants: ${p.variants!.map(v => v.option_name).join(", ")}`);
        }

        const text = lines.join("\n");
        return {
          content: [{
            type: "text",
            text: text.length > CHARACTER_LIMIT
              ? text.slice(0, CHARACTER_LIMIT) + "\n_[truncated — use blanxer_search_products to narrow results]_"
              : text,
          }]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Search Products (Public) ─────────────────────────────────────
  server.registerTool(
    "blanxer_search_products",
    {
      title: "Search Products",
      description: `Search products in your Blanxer store by keyword (public endpoint, no extra auth needed).

Args:
  - query (string): Search keyword (product name, category, etc.)
  - response_format: Output format

Returns matching products sorted by relevance. Product URLs: https://{subdomain}.blanxer.com/product/{slug}`,
      inputSchema: ResponseFormatSchema.extend({
        query: z.string().min(2).max(200).describe("Search keyword"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId, subDomain } = getAuth();
        const products = await apiRequest<Product[]>(
          `product/public/search/${storeId}`,
          "GET", undefined, { q: params.query }, false
        );

        if (!products.length) {
          return { content: [{ type: "text", text: `No products found matching '${params.query}'.` }] };
        }

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify({ products, count: products.length }, null, 2) }] };
        }

        const lines = [`# Search: '${params.query}' (${products.length} results)`, ""];
        for (const p of products) {
          lines.push(`## ${p.name}`);
          lines.push(`- **Price**: Rs ${p.price}${p.compare_at_price ? ` ~~Rs ${p.compare_at_price}~~` : ""}`);
          lines.push(`- **Stock**: ${p.in_stock ? p.quantity : "Out of stock"}`);
          lines.push(`- **URL**: https://${subDomain}.blanxer.com/product/${p.slug}`);
          if (p.colors?.length) lines.push(`- **Colors**: ${p.colors.join(", ")}`);
          if (p.sizes?.length) lines.push(`- **Sizes**: ${p.sizes.join(", ")}`);
          lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Get Product by Slug ──────────────────────────────────────────
  server.registerTool(
    "blanxer_get_product",
    {
      title: "Get Product Details",
      description: `Get full details of a product by its slug (public endpoint).

Args:
  - slug (string): Product slug (e.g. 'premium-t-shirt')
  - response_format: Output format

Returns full product with variants, sizes, inventory, and description.`,
      inputSchema: ResponseFormatSchema.extend({
        slug: z.string().describe("Product slug (e.g. 'premium-t-shirt')"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId, subDomain } = getAuth();
        const product = await apiRequest<Product>(
          `product/public/${storeId}/${params.slug}`,
          "GET", undefined, undefined, false
        );

        if (params.response_format === ResponseFormat.JSON) {
          return { content: [{ type: "text", text: JSON.stringify(product, null, 2) }] };
        }

        const hasVariants = product.variants && product.variants.length > 0;
        const lines = [
          `# ${product.name}`,
          `**ID**: ${product._id} | **Slug**: ${product.slug}`,
          `**URL**: https://${subDomain}.blanxer.com/product/${product.slug}`,
          "",
          `- **Status**: ${product.status} | **Channel**: ${product.channel === 1 ? "Online" : "POS"}`,
          ...(hasVariants
            ? [`- **Total Stock**: ${product.variants!.reduce((s, v) => s + v.quantity, 0)} units across ${product.variants!.length} variants`]
            : [`- **Price**: Rs ${product.price}${product.compare_at_price ? ` ~~Rs ${product.compare_at_price}~~` : ""}`,
               `- **Stock**: ${product.quantity} units`]),
          ...(product.barcode ? [`- **Barcode**: ${product.barcode}`] : []),
          ...(product.sku ? [`- **SKU**: ${product.sku}`] : []),
          ...(product.tags?.length ? [`- **Tags**: ${product.tags.join(", ")}`] : []),
          ...(product.categories?.length ? [`- **Categories (IDs)**: ${product.categories.join(", ")}`] : []),
          ...(product.colors?.length ? [`- **Colors**: ${product.colors.join(", ")}`] : []),
          ...(product.sizes?.length ? [`- **Sizes/Options**: ${product.sizes.join(", ")}`] : []),

          // Variants table
          ...(hasVariants ? formatVariants(product.variants!) : []),

          // Custom fields
          ...(product.custom_fields?.length
            ? ["", "## Custom Fields (Customer Input)", ...product.custom_fields.map(([type, label, required]) =>
                `- **${label}** (${type})${required ? " ← required" : " ← optional"}`)]
            : []),

          ...(product.description ? ["", "## Description", product.description.replace(/<[^>]+>/g, "")] : []),
          "",
          `_Created: ${product.created_at} | Updated: ${product.updated_at}_`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Create Product ───────────────────────────────────────────────
  server.registerTool(
    "blanxer_create_product",
    {
      title: "Create Product",
      description: `Create a new product in your Blanxer store.

Args:
  - name (string): Product name
  - slug (string): URL-friendly slug (e.g. 'premium-t-shirt', must be unique)
  - price (number): Selling price in NPR
  - compare_at_price (number): Original price (for showing discount, optional)
  - quantity (number): Initial stock quantity
  - in_stock (boolean): Whether product is available
  - description (string): Short description (HTML supported)
  - categories (string[]): Category names
  - channel (number): 1=Online, 2=POS (default 1)
  - image_urls (string[]): Image URLs (upload first via blanxer_upload_file)

Returns created product. Note: Upload images first using blanxer_upload_file.`,
      inputSchema: z.object({
        name: z.string().min(1).max(200).describe("Product name"),
        slug: z.string().min(1).max(200).describe("URL slug (unique, e.g. 'premium-t-shirt')"),
        price: z.number().positive().describe("Selling price in NPR"),
        compare_at_price: z.number().positive().optional().describe("Original price for discount display"),
        quantity: z.number().int().min(0).default(0).describe("Initial stock quantity"),
        in_stock: z.boolean().default(true).describe("Product availability"),
        description: z.string().optional().describe("Short description (HTML supported)"),
        long_description: z.string().optional().describe("Long description (HTML supported)"),
        categories: z.array(z.string()).default([]).describe("Category names array"),
        channel: z.number().int().min(1).max(2).default(1).describe("Sales channel: 1=Online, 2=POS"),
        image_urls: z.array(z.string().url()).default([]).describe("Image URLs from blanxer_upload_file"),
        barcode: z.string().optional().describe("Product barcode"),
        sizes: z.array(z.string()).optional().describe("Size/option names for variants (e.g. ['6by8in', '8by12in'])"),
        custom_fields: z.array(
          z.tuple([z.string(), z.string(), z.boolean(), z.string()])
        ).optional().describe("Customer input fields as [type, label, required, default]. Types: 'image', 'text'. E.g. [['image','Add Your Image',true,''],['text','Notes',false,'']]"),
        tags: z.array(z.string()).optional().describe("Product tags"),
        seo_title: z.string().optional().describe("SEO title"),
        seo_description: z.string().optional().describe("SEO description"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const body = {
          ...params,
          images: params.image_urls.map(url => ({ _id: url, url })),
        };
        const product = await apiRequest<Product>(`product/${storeId}`, "POST", body);
        return { content: [{ type: "text", text: `Product created successfully!\n- **Name**: ${product.name}\n- **ID**: ${product._id}\n- **Slug**: ${product.slug}\n- **Price**: Rs ${product.price}` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Update Product ───────────────────────────────────────────────
  server.registerTool(
    "blanxer_update_product",
    {
      title: "Update Product",
      description: `Update general product fields. Only include fields you want to change.

Args:
  - product_id (string): Product _id
  - name (string): New product name
  - price (number): New price in NPR
  - compare_at_price (number): New compare-at price
  - description (string): New description (HTML)
  - categories (string[]): Replace categories
  - in_stock (boolean): Stock availability
  - quantity (number): New stock quantity
  - image_urls (string[]): Replace image URLs

Returns confirmation.`,
      inputSchema: z.object({
        product_id: z.string().describe("Product _id to update"),
        name: z.string().optional().describe("New product name"),
        price: z.number().positive().optional().describe("New price in NPR"),
        compare_at_price: z.number().positive().optional().describe("New compare-at price"),
        description: z.string().optional().describe("New description (HTML)"),
        categories: z.array(z.string()).optional().describe("Replace categories array"),
        in_stock: z.boolean().optional().describe("Stock availability"),
        quantity: z.number().int().min(0).optional().describe("New stock quantity"),
        image_urls: z.array(z.string().url()).optional().describe("Replace image URLs"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const { product_id, image_urls, ...rest } = params;
        const body: Record<string, unknown> = { ...rest };
        if (image_urls) {
          body.image_urls = image_urls;
          body.images = image_urls.map(url => ({ _id: url, url }));
        }
        await apiRequest<unknown>(`product/general/${storeId}/${product_id}`, "POST", body);
        return { content: [{ type: "text", text: `Product ${product_id} updated successfully.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Update Variant / Inventory ───────────────────────────────────
  server.registerTool(
    "blanxer_update_product_inventory",
    {
      title: "Update Product Variant & Inventory",
      description: `Update inventory, pricing, SKU, and variant details for a product.

For products WITH variants, use the variants array to update each variant's price/stock.
For products WITHOUT variants, use top-level price/quantity fields.

Args:
  - product_id (string): Product _id
  - quantity (number): Stock quantity (for non-variant products)
  - price (number): Price in NPR (for non-variant products)
  - compare_at_price (number): Compare-at price
  - cost_per_item (number): Cost price for margin tracking
  - sku (string): SKU code
  - weight (number): Weight in kg
  - barcode (string): Barcode
  - continue_selling (boolean): Allow selling when out of stock
  - sizes (array): Size/option names array (e.g. ['6by8in', '8by12in'])
  - variants (array): For products with variants — each item: { option_name, price, compare_at_price, quantity, sku, barcode }

Returns confirmation.`,
      inputSchema: z.object({
        product_id: z.string().describe("Product _id"),
        quantity: z.number().int().min(0).optional().describe("Stock quantity (non-variant products)"),
        price: z.number().positive().optional().describe("Price in NPR (non-variant products)"),
        compare_at_price: z.number().positive().optional().describe("Compare-at price"),
        cost_per_item: z.number().min(0).optional().describe("Cost price per item"),
        sku: z.string().optional().describe("SKU code"),
        barcode: z.string().optional().describe("Barcode"),
        weight: z.number().positive().optional().describe("Weight in kg"),
        continue_selling: z.boolean().optional().describe("Allow selling when out of stock"),
        sizes: z.array(z.string()).optional().describe("Size/option names (e.g. ['6by8in', '8by12in'])"),
        variants: z.array(z.object({
          option_name: z.string().describe("Variant option name (must match existing)"),
          price: z.number().positive().optional(),
          compare_at_price: z.number().positive().optional(),
          quantity: z.number().int().min(0).optional(),
          sku: z.string().optional(),
          barcode: z.string().optional(),
        })).optional().describe("Per-variant updates (for products with variants)"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const { product_id, ...body } = params;
        await apiRequest<unknown>(`product/variant_inventory/${storeId}/${product_id}`, "POST", body);
        return { content: [{ type: "text", text: `Product ${product_id} inventory/variant updated successfully.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
