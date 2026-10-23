/**
 * POST /api/v1/approvals/[id]/decision — decisão humana sobre um job.
 * body: { orgId, decision: 'approve' | 'reject', justification }.
 * approve → QUEUED · reject → CANCELLED. Registra o aprovador em auditoria.
 *
 * FASE 2B (C4) — decisão EXCLUSIVAMENTE humana, garantido em código:
 * `requireHumanSession` recusa qualquer chave de API (m2m) MESMO com o
 * scope `approvals:decide` — antes, a separação humano/máquina era só
 * documental (bloqueio B4 da Fase 1). Para sessão de usuário, exige-se
 * ainda papel owner/admin na org (resolveOrgScope). O scope continua a
 * ser verificado por defesa em profundidade e para LEITURA da fila
 * (GET /api/v1/approvals), onde máquinas podem consultar.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import {
  authenticate,
  actorOf,
  requireHumanSession,
  requireScope,
  resolveOrgScope,
} from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { decideApproval } from "@/lib/jobs/service";
import { jobDecisionSchema, parseOrThrow, uuidSchema } from "@/lib/validators";

const decisionBodySchema = z.object({
  orgId: uuidSchema,
  decision: jobDecisionSchema.shape.decision,
  justification: jobDecisionSchema.shape.justification,
});

export async function POST(
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
    // FASE 2B (C4): só sessão humana decide — chave de API é recusada
    // aqui, mesmo com o scope approvals:decide.
    requireHumanSession(auth);
    requireScope(auth, "approvals:decide");

    const { id } = await params;
    const body = parseOrThrow(
      decisionBodySchema,
      await request.json().catch(() => null),
      "Corpo inválido.",
    );
    // Sessão de usuário: só owner/admin decide (membership + papel).
    const orgId = await resolveOrgScope(auth, body.orgId, ["owner", "admin"]);

    const job = await decideApproval(
      id,
      orgId,
      body.decision,
      body.justification,
      actorOf(auth),
    );

    return apiJson({ job }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
