/**
 * GET /api/v1/athena/tools — descoberta de ferramentas pela ATHENA Control.
 *
 * Auth: sessão ou Bearer <api key> com scope `tools:read` (a mesma regra
 * de `GET /api/v1/tools`). A org em escopo é a da chave (m2m) ou a do
 * parâmetro `orgId` com membership verificado (sessão) — ver
 * `resolveOrgScope` em lib/api-auth.ts.
 *
 * Diferença para `GET /api/v1/tools`: a resposta descreve CONTRATOS
 * (adapters em código + catálogo), não linhas da tabela `tools` — por
 * isso NÃO exige Supabase configurado e NÃO inventa linhas por org.
 * Cada entrada traz: capabilities, `integrationStatus` (ready só com
 * executor real — hoje sempre "pending"), `requiresApproval` do contrato
 * e `inputs` quando o catálogo os especifica.
 *
 * Permissões por agente: a rota NÃO afirma vínculo agente↔chamador.
 * A tabela `integrations` não tem `agent_id`, por isso não há como
 * resolver que agente uma chave representa (ver
 * lib/athena/agent-permissions.ts). A resposta diz isso explicitamente
 * (`agentPermissions.linked: false`) em vez de devolver `allowed: true`
 * inventado. Quando o vínculo existir, a descoberta passa a aceitar as
 * linhas resolvidas de `agent_tool_permissions` em
 * `buildAthenaToolDiscovery(rows)`.
 *
 * Erros seguem { error: { code, message, requestId } } + x-request-id.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import {
  buildAthenaToolDiscovery,
  discoveryExecutionSummary,
} from "@/lib/athena/discovery";

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

    const tools = buildAthenaToolDiscovery();
    return apiJson(
      {
        orgId,
        tools,
        execution: discoveryExecutionSummary(tools),
        caller:
          auth.kind === "m2m"
            ? {
                kind: "m2m",
                scopes: auth.scopes,
                canCreateJobs: auth.scopes.includes("jobs:write"),
                // approvals:decide NUNCA decide: requireHumanSession
                // (lib/api-auth.ts) recusa qualquer chave m2m na decisão.
                canDecideApprovals: false,
              }
            : {
                kind: "user",
                scopes: null,
                canCreateJobs: null,
                canDecideApprovals: null,
              },
        agentPermissions: {
          linked: false,
          note: "Sem vínculo integração↔agente no schema (integrations sem agent_id): nenhuma permissão por agente é afirmada nesta resposta. Ver lib/athena/agent-permissions.ts.",
        },
      },
      { requestId, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
