/**
 * GET /api/v1/tools/[id] — detalhe da tool.
 * Fonte: tabela `tools`. Se não houver linha no banco mas existir um adapter
 * registrado em código, retorna a representação honesta do contrato
 * (status 'in-development') — sem inventar dados de catálogo.
 * Inclui `integrationStatus`: 'ready' só com executor real conectado.
 *
 * FASE 2A (C1) — isolamento entre organizações: a linha é procurada SEMPRE
 * dentro da org resolvida (resolveOrgScope). Tool de outra org e tool
 * inexistente produzem a mesma resposta (404) — indistintas. O fallback de
 * adapter em código não é dado de nenhuma org (é o contrato público do
 * adaptador), por isso continua acessível a qualquer autenticado.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/auth";
import { toolRegistry } from "@/lib/adapters/index";
import { integrationStatusFor } from "@/lib/jobs/service";
import { toToolDTO } from "../route";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const { id } = await params;

    // CORREÇÃO ATHENA CONNECT (2026-10-26): o fallback de contrato em
    // código era inalcançável sem Supabase — o `throw notConfigured()`
    // corria ANTES dele, por isso uma Athena sem BD configurada nunca
    // descobria o contrato de uma tool. Sem BD, só o contrato em código
    // pode responder (é público, sem dados de org); sem adapter, 404.
    if (!isSupabaseConfigured()) {
      const adapterOnly = toolRegistry.adapterFor(id);
      if (adapterOnly) {
        return apiJson(
          {
            tool: {
              id: adapterOnly.id,
              name: adapterOnly.id,
              description:
                "Contrato registrado em código; ainda sem entrada no catálogo (tabela tools).",
              version: adapterOnly.version,
              status: "in-development",
              capabilities: adapterOnly.capabilities,
              integrationStatus: integrationStatusFor(adapterOnly.id),
              dryRun: adapterOnly.dryRunInfo(),
              updatedAt: null,
            },
          },
          { requestId, headers: rl.headers },
        );
      }
      throw HubError.notFound("Tool");
    }

    const supabase = getSupabaseAdmin();
    // Capabilities reais vêm embutidas de `tool_capabilities` (ver toToolDTO).
    // FASE 2A (C1): id + org_id — uma tool de outra org é invisível aqui.
    const { data, error } = await supabase
      .from("tools")
      .select("*, tool_capabilities(name)")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) throw new HubError("INTERNAL", "Falha ao carregar a tool.", 500);

    if (data) {
      const dto = toToolDTO(data as Record<string, unknown>);
      return apiJson(
        { tool: { ...dto, integrationStatus: integrationStatusFor(dto.id) } },
        { requestId, headers: rl.headers },
      );
    }

    // Sem linha no catálogo, mas com contrato registrado em código.
    const adapter = toolRegistry.adapterFor(id);
    if (adapter) {
      return apiJson(
        {
          tool: {
            id: adapter.id,
            name: adapter.id,
            description:
              "Contrato registrado em código; ainda sem entrada no catálogo (tabela tools).",
            version: adapter.version,
            status: "in-development",
            capabilities: adapter.capabilities,
            integrationStatus: integrationStatusFor(adapter.id),
            dryRun: adapter.dryRunInfo(),
            updatedAt: null,
          },
        },
        { requestId, headers: rl.headers },
      );
    }

    throw HubError.notFound("Tool");
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
