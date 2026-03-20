import { AsyncLocalStorage } from "node:async_hooks";
import { API_BASE_URL } from "../constants.js";
import type { AuthContext, AuthResponse } from "../types.js";

// ─── Per-API-key auth cache ───────────────────────────────────────────────────
const authCache = new Map<string, AuthContext>();

export async function resolveAuth(apiKey: string): Promise<AuthContext> {
  if (authCache.has(apiKey)) return authCache.get(apiKey)!;

  const res = await apiFetch<AuthResponse>("api-key/check", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
    requireAuth: false,
  });

  if (!res.success) throw new Error("Invalid Blanxer API key");

  const ctx: AuthContext = {
    token: res.token,
    storeId: res.store._id,
    storeName: res.store.name,
    subDomain: res.store.sub_domain,
  };

  authCache.set(apiKey, ctx);
  console.error(`[auth] Store: ${ctx.storeName} (${ctx.storeId})`);
  return ctx;
}

// ─── Per-request auth context ─────────────────────────────────────────────────
const authStore = new AsyncLocalStorage<AuthContext>();

export function runWithAuth<T>(ctx: AuthContext, fn: () => T): T {
  return authStore.run(ctx, fn);
}

export function getAuth(): AuthContext {
  const ctx = authStore.getStore();
  if (!ctx) throw new Error("No auth context. Pass X-Blanxer-Api-Key header.");
  return ctx;
}

// ─── Single-tenant startup init ───────────────────────────────────────────────
let _defaultAuth: AuthContext | null = null;

export async function initAuth(): Promise<AuthContext> {
  const apiKey = process.env.BLANXER_API_KEY;
  if (!apiKey) throw new Error("BLANXER_API_KEY environment variable is required");
  _defaultAuth = await resolveAuth(apiKey);
  return _defaultAuth;
}

export function getDefaultAuth(): AuthContext | null {
  return _defaultAuth;
}

// ─── Core fetch helper (replaces axios — works in Node.js 18+ and Workers) ───
interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  params?: Record<string, unknown>;
  requireAuth?: boolean;
}

async function apiFetch<T>(endpoint: string, opts: FetchOptions = {}): Promise<T> {
  const { method = "GET", body, params, requireAuth = true } = opts;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  if (requireAuth) {
    headers["Authorization"] = `Bearer ${getAuth().token}`;
  }

  let url = `${API_BASE_URL}/${endpoint}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, { method, headers, body });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = "";
    try { msg = (JSON.parse(text) as Record<string, unknown>)?.message as string ?? ""; } catch {}
    throw new ApiError(res.status, msg || text);
  }

  return res.json() as Promise<T>;
}

export async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  data?: unknown,
  params?: Record<string, unknown>,
  requireAuth = true
): Promise<T> {
  return apiFetch<T>(endpoint, {
    method,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    params,
    requireAuth,
  });
}

// ─── Error types ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400: return `Error: Bad request. ${error.message}`;
      case 401: return "Error: Unauthorized. Check your Blanxer API key.";
      case 403: return "Error: Permission denied for this resource.";
      case 404: return "Error: Resource not found. Verify the ID is correct.";
      case 422: return `Error: Validation failed. ${error.message}`;
      case 429: return "Error: Rate limit exceeded. Please wait before retrying.";
      default:  return `Error: API request failed (${error.status}). ${error.message}`;
    }
  }
  if (error instanceof TypeError && String(error.message).includes("fetch")) {
    return "Error: Could not connect to api.blanxer.com.";
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
