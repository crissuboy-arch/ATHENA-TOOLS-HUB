/**
 * Catálogo de tools — leitura a partir da tabela `tools`.
 * Sem fallback inventado: sem Supabase configurado → 503 honesto.
 *
 * GET /api/v1/tools — lista (auth: sessão ou API key com tools:read)
 *
 * FASE 2A (C1) — isolamento entre organizações: a lista é SEMPRE filtrada
 * pela org resolvida (resolveOrgScope, o mesmo padrão dos demais endpoints
 * v1): key m2m só vê a org da chave; sessão só vê orgs onde tem membership.
 * Tools são linhas por org (org_id NOT NULL) — não existe leitura global.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/auth";
import {
  integrationStatusFor,
  type IntegrationStatus,
} from "@/lib/jobs/service";

export interface ToolDTO {
  id: string;
  /** Slug estável (tools.slug, único por org) — a identidade que o registry de adapters entende. */
  slug: string;
  name: string;
  description: string | null;
  version: string;
  status: string;
  capabilities: string[];
  updatedAt: string;
  /**
   * 'ready' só com executor real conectado. Calculado pelo SLUG (não pelo
   * uuid): o registry de adapters é chaveado por slug, por isso calcular
   * pelo uuid devolvia sempre 'pending' — mesmo com executor pronto.
   */
  integrationStatus: IntegrationStatus;
}

interface ToolCapabilityRow {
  name: string;
}

/**
 * FASE 1 — drift código↔schema corrigido (ver supabase/migrations/0001_core.sql):
 * - a tabela `tools` NÃO tem coluna `status`; a coluna real é `state`
 *   (enum tool_state). `status` aqui expõe o valor de `state`.
 * - a tabela `tools` NÃO tem coluna `capabilities`; as capabilities reais
 *   vivem em `tool_capabilities` (uma linha por capability, por tool_id).
 *   O select deve embutir `tool_capabilities(name)` — ver GET abaixo.
 * - a tabela `tools` NÃO tem coluna `version`; "0.0.0" é o default honesto
 *   documentado (histórico de versões: tabela `tool_versions`, FASE 2).
 */
export interface ToolsListResponse {
  tools: ToolDTO[];
  /** Alias para consumidores genéricos (ex.: useApiList do dashboard). */
  items: ToolDTO[];
  total: number;
}

/**
 * Forma da lista: `tools` é o contrato histórico; `items` + `total`
 * são aliases aditivos para consumidores que só entendem listas
 * genéricas — sem eles, o dashboard lia sempre 0 ferramentas.
 */
export function buildToolsListResponse(tools: ToolDTO[]): ToolsListResponse {
  return { tools, items: tools, total: tools.length };
}

export function toToolDTO(row: Record<string, unknown>): ToolDTO {
  const embedded = row.tool_capabilities;
  const capabilities: string[] = Array.isArray(embedded)
    ? (embedded as Array<ToolCapabilityRow | string>).map((c) =>
        typeof c === "string" ? c : String(c.name ?? ""),
      ).filter(Boolean)
    : [];
  const slug = String(row.slug ?? "");
  return {
    id: String(row.id),
    slug,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    version: String(row.version ?? "0.0.0"),
    status: String(row.state ?? "unknown"),
    capabilities,
    updatedAt: String(row.updated_at),
    // Fonte verdadeira do estado do executor: o slug, nunca o uuid.
    integrationStatus: integrationStatusFor(slug),
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
    const orgId = await resolveOrgScope(
      auth,
      request.nextUrl.searchParams.get("orgId"),
    );

    if (!isSupabaseConfigured()) throw HubError.notConfigured();
    const supabase = getSupabaseAdmin();
    // Capabilities reais vêm embutidas de `tool_capabilities` (ver toToolDTO).
    // FASE 2A (C1): filtro de org obrigatório — service_role ignora RLS,
    // por isso o isolamento vive aqui, como nos serviços de jobs/missões.
    const { data, error } = await supabase
      .from("tools")
      .select("*, tool_capabilities(name)")
      .eq("org_id", orgId)
      .order("name", { ascending: true });
    if (error) throw new HubError("INTERNAL", "Falha ao listar tools.", 500);

    return apiJson(
      buildToolsListResponse(
        (data ?? []).map((r) => toToolDTO(r as Record<string, unknown>)),
      ),
      { requestId, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
