/**
 * Catálogo de tools — leitura a partir da tabela `tools`.
 * Sem fallback inventado: sem Supabase configurado → 503 honesto.
 *
 * GET /api/v1/tools — lista (auth: sessão ou API key com tools:read)
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/auth";

export interface ToolDTO {
  id: string;
  name: string;
  description: string | null;
  version: string;
  status: string;
  capabilities: string[];
  updatedAt: string;
}

export function toToolDTO(row: Record<string, unknown>): ToolDTO {
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    version: String(row.version ?? "0.0.0"),
    status: String(row.status ?? "unknown"),
    capabilities: Array.isArray(row.capabilities)
      ? (row.capabilities as string[])
      : [],
    updatedAt: String(row.updated_at),
  };
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const auth = await authenticate(request);
    requireScope(auth, "tools:read");

    if (!isSupabaseConfigured()) throw HubError.notConfigured();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tools")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new HubError("INTERNAL", "Falha ao listar tools.", 500);

    return apiJson(
      { tools: (data ?? []).map((r) => toToolDTO(r as Record<string, unknown>)) },
      { requestId, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
