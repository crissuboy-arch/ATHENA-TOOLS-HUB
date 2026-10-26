/**
 * POST /api/v1/athena/missions — recebe uma missão da ATHENA Control.
 *
 * Auth: Bearer <api key> + anti-replay (X-Request-Timestamp, X-Nonce),
 * scope jobs:write. A org é a da chave (org_id divergente → 403).
 *
 * Fluxo:
 *   1. valida o payload da missão (400 VALIDATION se inválido);
 *   2. verificação agente↔ferramenta (Opção A, fail-closed): integração
 *      sem agente, agente desconhecido, tool não associada ou schema
 *      indisponível (0012 por aplicar) → 403 FORBIDDEN, sem criar job;
 *   3. resolve requires_human_approval contra o contrato da tool
 *      (409 CONFLICT em divergência — sem ajuste silencioso);
 *   4. cria o job de forma idempotente: mission_id é preservado como
 *      idempotencyKey — reenvio do mesmo mission_id retorna o job
 *      original (200 + deduplicated:true; primeira vez: 201);
 *   5. se a missão exige aprovação humana, o job cai em PENDING_APPROVAL
 *      e a resposta aponta o endpoint de decisão do sistema de approvals
 *      existente.
 *
 * Erros seguem { error: { code, message, requestId } } + x-request-id.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import {
  actorOf,
  authenticate,
  requireScope,
  resolveOrgScope,
} from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { createJob } from "@/lib/jobs/service";
import {
  buildMissionResponse,
  resolveMissionApproval,
} from "@/lib/athena/missions";
import { authorizeMissionToolAccess } from "@/lib/athena/agent-intake";
import { missionToJobInput, parseMission } from "@/lib/athena/contract";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const auth = await authenticate(request);
    requireScope(auth, "jobs:write");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      throw HubError.validation("Corpo JSON inválido.");
    }
    const mission = parseMission(body);
    const orgId = await resolveOrgScope(auth, mission.org_id);

    // Verificação agente↔ferramenta (Opção A, fail-closed) ANTES de
    // qualquer criação: negado = 403 estruturado, job nunca criado.
    const gate = await authorizeMissionToolAccess(auth, mission.tool_id);
    if (!gate.allowed) {
      throw HubError.forbidden(
        `Missão negada pela associação agente↔ferramenta (${gate.reason}).`,
      );
    }

    // Divergência de aprovação → 409 (explícito, sem fallback).
    const requiresHumanApproval = resolveMissionApproval(mission);

    const { job, created } = await createJob(
      missionToJobInput(mission, orgId),
      actorOf(auth),
    );

    const response = await buildMissionResponse(
      job,
      mission.mission_id,
      { mission, requiresHumanApproval },
    );

    return apiJson(
      { mission: response, deduplicated: !created },
      { requestId, status: created ? 201 : 200, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
