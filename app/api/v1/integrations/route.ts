/**
 * GET /api/v1/integrations — lista de integrações da org.
 *
 * Criada na finalização G3 (27/10/2026): o dashboard consultava
 * `/api/v1/integrations` e a rota NÃO existia (404 permanente) — só
 * existiam as rotas de chaves sob `[integrationId]/api-keys`.
 *
 * Auth: sessão ou API key com tools:read (o scope de leitura de
 * catálogo mais próximo; não existe scope próprio de integrações).
 * Isolamento (C1): a lista é SEMPRE filtrada pela org resolvida
 * (resolveOrgScope) — key m2m só vê a org da chave; sessão só vê a
 * org do parâmetro orgId com membership.
 *
 * NUNCA devolve `config`: mesmo sendo "só config não-secreta" no
 * schema, a lista não precisa dela e não a vaza por esta rota.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/auth";

export interface IntegrationDTO {
  id: string;
  name: string;
  provider: string;
  type: string;
  state: string;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationsListResponse {
  integrations: IntegrationDTO[];
  /** Alias para consumidores genéricos (ex.: useApiList do dashboard). */
  items: IntegrationDTO[];
  total: number;
}

export function toIntegrationDTO(row: Record<string, unknown>): IntegrationDTO {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: String(row.provider),
    type: String(row.type),
    state: String(row.state ?? "unknown"),
    lastTestAt: (row.last_test_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function buildIntegrationsListResponse(
  integrations: IntegrationDTO[],
): IntegrationsListResponse {
  return { integrations, items: integrations, total: integrations.length };
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
    const orgId = await resolveOrgScope(
      auth,
      request.nextUrl.searchParams.get("orgId"),
    );

    if (!isSupabaseConfigured()) throw HubError.notConfigured();
    const supabase = getSupabaseAdmin();
    // Sem `config` no select, por desenho (ver comentário do módulo).
    const { data, error } = await supabase
      .from("integrations")
      .select("id,name,provider,type,state,last_test_at,created_at,updated_at")
      .eq("org_id", orgId)
      .order("name", { ascending: true });
    if (error) throw new HubError("INTERNAL", "Falha ao listar integrações.", 500);

    return apiJson(
      buildIntegrationsListResponse(
        (data ?? []).map((r) => toIntegrationDTO(r as Record<string, unknown>)),
      ),
      { requestId, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
