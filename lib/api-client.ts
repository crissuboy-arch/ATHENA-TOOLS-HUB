/** HTTP client for the Tools Hub v1 API.
 *
 * Conventions (from the real API contract):
 * - camelCase fields: orgId, toolId, idempotencyKey, perPage…
 * - lists: { items, page, perPage, total }
 * - single: { job } / { tools } / { events } / { assets } (no { data } envelope)
 * - all requests carry session cookies (`credentials: "include"`)
 * - 401 → redirect to /login · 503 → Supabase not configured (honest states)
 */

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
    throw new ApiError(401, "Sessão expirada. Redirecionando para o login…");
  }

  const body = parseBody(await res.text()) as T;

  if (!res.ok) {
    const rec = (body ?? {}) as {
      error?: { message?: string };
      message?: string;
    };
    const message =
      rec.error?.message ?? rec.message ?? `Falha na requisição (HTTP ${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  return body;
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export interface PageInfo {
  page: number;
  perPage: number;
  total: number;
}

/** Lists come back as { items, page, perPage, total }. */
export async function apiList<T>(path: string): Promise<{ items: T[]; page: PageInfo }> {
  const body = (await request<unknown>(path, { method: "GET" })) as {
    items?: unknown;
    data?: unknown;
    page?: number;
    perPage?: number;
    per_page?: number;
    total?: number;
    meta?: { page?: number; per_page?: number; total?: number };
  } | null;
  const rawItems = Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.data)
      ? body.data
      : [];
  return {
    items: rawItems as T[],
    page: {
      page: body?.page ?? body?.meta?.page ?? 1,
      perPage: body?.perPage ?? body?.meta?.per_page ?? rawItems.length,
      total: body?.total ?? body?.meta?.total ?? rawItems.length,
    },
  };
}

export async function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export async function apiPut<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Append the required orgId query param. */
export function withOrg(path: string, orgId: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}orgId=${encodeURIComponent(orgId)}`;
}

/** 503 from the API means Supabase is not configured (see docs/SUPABASE_SETUP.md). */
export function isDbNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export const DB_NOT_CONFIGURED_MESSAGE =
  "Banco de dados não configurado. Siga as instruções em docs/SUPABASE_SETUP.md e recarregue a página.";
