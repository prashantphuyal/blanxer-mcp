// ─── Auth ──────────────────────────────────────────────────────────────────────
export interface AuthResponse {
  success: boolean;
  token: string;
  store: {
    _id: string;
    name: string;
    phone_number: string;
    sub_domain: string;
    custom_domain?: string;
    owner: string;
  };
}

export interface AuthContext {
  token: string;
  storeId: string;
  storeName: string;
  subDomain: string;
}

// ─── Orders ────────────────────────────────────────────────────────────────────
export interface OrderedProduct {
  product_name: string;
  quantity: number;
  price: number;
}

export interface Order {
  _id: string;
  order_number: string;
  status: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled" | "Returned";
  payment_status: string;
  payment_method: string;
  customer_full_name: string;
  customer_phone_number: string;
  customer_address_city: string;
  product_total_price: number;
  delivery_charge: number;
  cod_amount: number;
  created_at: string;
  ordered_products: OrderedProduct[];
  [key: string]: unknown; // extra fields on full detail response
}

export interface PrintRequestResponse {
  id: string;
}

// ─── Products ─────────────────────────────────────────────────────────────────

/** [type, label, required, default_value] */
export type CustomField = [string, string, boolean, string];

export interface ProductVariant {
  _id: string;
  option_name: string;       // e.g. "6by8in", "Red-M"
  image_url?: string;
  price: number;
  compare_at_price?: number;
  quantity: number;
  sku?: string;
  weight?: number;
  barcode?: string;
  inventory_summary?: unknown[];
}

export interface Product {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  long_description?: string;
  // Product-level price is 0 when has_variants=true; use variant prices instead
  price: number;
  compare_at_price?: number;
  has_variants?: boolean;
  in_stock?: boolean;
  quantity: number;
  image_urls: string[];
  status: "Active" | "Inactive" | "Draft";
  channel: number;            // 1=Online, 2=POS
  categories: string[];       // Array of category ObjectIds
  colors: string[];
  sizes: string[];             // Variant option names when size-based
  color_name?: string;
  size_name?: string;
  variants?: ProductVariant[];
  custom_fields?: CustomField[];
  tags?: string[];
  sku?: string;
  barcode?: string;
  alt_barcode?: string;
  weight?: number;
  continue_selling?: boolean;
  inventory_summary?: unknown[];
  active_offers?: unknown[];
  seo_title?: string;
  seo_description?: string;
  seo_image?: string;
  search_key?: string;
  total_rating?: number;
  review_count?: number;
  created_at?: string;
  updated_at?: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────
export interface Outlet {
  _id: string;
  name: string;
  address: string;
  is_default: boolean;
}

// ─── SMS ──────────────────────────────────────────────────────────────────────
export interface SMSCredits {
  credits: number;
  used: number;
  remaining: number;
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export interface DashboardSummary {
  today_orders: number;
  today_revenue: number;
  pending: number;
  processing: number;
  delivered: number;
  [key: string]: unknown;
}

export interface SalesAnalytics {
  revenue: number;
  orders: number;
  avg_order_value: number;
  top_products: unknown[];
  daily_breakdown: unknown[];
  [key: string]: unknown;
}

// ─── Categories ───────────────────────────────────────────────────────────────
export interface Category {
  _id: string;
  name: string;
  [key: string]: unknown;
}
