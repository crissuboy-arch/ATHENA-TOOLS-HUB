/**
 * GET /api/v1/tools/[id] — detalhe da tool.
 * Fonte: tabela `tools`. Se não houver linha no banco mas existir um adapter
 * registrado em código, retorna a representação honesta do contrato
 * (status 'in-development') — sem inventar dados de catálogo.
 * Inclui `integrationStatus`: 'ready' só com executor real conectado.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope } from "@/lib/api-auth";
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
    if (!isSupabaseConfigured()) throw HubError.notConfigured();

    const { id } = await params;
    const supabase = getSupabaseAdmin();
    // Capabilities reais vêm embutidas de `tool_capabilities` (ver toToolDTO).
    const { data, error } = await supabase
      .from("tools")
      .select("*, tool_capabilities(name)")
      .eq("id", id)
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
