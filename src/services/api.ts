import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "../constants.js";
import type { AuthContext, AuthResponse } from "../types.js";

// ─── Per-API-key auth cache ───────────────────────────────────────────────────
const authCache = new Map<string, AuthContext>();

export async function resolveAuth(apiKey: string): Promise<AuthContext> {
  if (authCache.has(apiKey)) return authCache.get(apiKey)!;

  const res = await axios.post<AuthResponse>(`${API_BASE_URL}/api-key/check`, { api_key: apiKey });

  if (!res.data.success) throw new Error("Invalid Blanxer API key");

  const ctx: AuthContext = {
    token: res.data.token,
    storeId: res.data.store._id,
    storeName: res.data.store.name,
    subDomain: res.data.store.sub_domain,
  };

  authCache.set(apiKey, ctx);
  console.error(`[auth] Resolved store: ${ctx.storeName} (${ctx.storeId})`);
  return ctx;
}

// ─── Per-request auth context (AsyncLocalStorage) ────────────────────────────
import { AsyncLocalStorage } from "async_hooks";

const authStore = new AsyncLocalStorage<AuthContext>();

export function runWithAuth<T>(ctx: AuthContext, fn: () => T): T {
  return authStore.run(ctx, fn);
}

export function getAuth(): AuthContext {
  const ctx = authStore.getStore();
  if (!ctx) throw new Error("No auth context. Pass X-Blanxer-Api-Key header.");
  return ctx;
}

// ─── Startup single-tenant mode (env var) ────────────────────────────────────
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

// ─── Axios request helper ─────────────────────────────────────────────────────
export async function apiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  data?: unknown,
  params?: Record<string, unknown>,
  requireAuth = true
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  if (requireAuth) {
    headers["Authorization"] = `Bearer ${getAuth().token}`;
  }

  const response = await axios({
    method,
    url: `${API_BASE_URL}/${endpoint}`,
    data,
    params,
    timeout: 30000,
    headers,
  });

  return response.data as T;
}

// ─── Error formatter ──────────────────────────────────────────────────────────
export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const msg = (error.response.data as Record<string, unknown>)?.message ?? "";
      switch (status) {
        case 400: return `Error: Bad request. ${msg}`;
        case 401: return "Error: Unauthorized. Token may have expired — the server will re-authenticate on the next request.";
        case 403: return "Error: Permission denied for this resource.";
        case 404: return "Error: Resource not found. Verify the ID is correct.";
        case 422: return `Error: Validation failed. ${msg}`;
        case 429: return "Error: Rate limit exceeded. Please wait before retrying.";
        default:  return `Error: API request failed (${status}). ${msg}`;
      }
    }
    if (error.code === "ECONNABORTED") return "Error: Request timed out.";
    if (error.code === "ECONNREFUSED") return "Error: Could not connect to api.blanxer.com.";
    return `Error: Network error — ${error.message}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
