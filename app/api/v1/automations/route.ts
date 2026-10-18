/**
 * GET /api/v1/automations — catálogo honesto das capacidades de automação
 * (FASE 7, conceitos INEMA como dados + validadores). Somente leitura.
 * Scope tools:read. Não toca nas rotas existentes.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { automationCatalog } from "@/lib/automations";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const auth = await authenticate(request);
    requireScope(auth, "tools:read");

    return apiJson(
      {
        automations: automationCatalog,
        note: "executionReady: false = planeia/valida estruturas; não executa. Publicação desativada até autorização explícita.",
      },
      { requestId, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
