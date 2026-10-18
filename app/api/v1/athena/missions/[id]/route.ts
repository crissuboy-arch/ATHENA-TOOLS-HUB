/**
 * GET /api/v1/athena/missions/[id] — estado sincronizado da missão.
 *
 * Auth: Bearer <api key> + anti-replay, scope jobs:read.
 * O {id} é o mission_id gerado pela Athena (preservado como
 * idempotencyKey do job). A resposta traz o estado no vocabulário
 * Athena (ver lib/athena/adapter.ts) mais o estado interno do Hub
 * para debug, a correlação missão↔job e, em estado terminal, o
 * resultado e os assets produzidos (vazio honesto quando nada existe).
 *
 * Missão inexistente → 404 NOT_FOUND. Nada é inventado.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { buildMissionResponse, findJobByMissionId } from "@/lib/athena/missions";
import { missionIdParamSchema } from "@/lib/athena/contract";
import { parseOrThrow } from "@/lib/validators";

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
    requireScope(auth, "jobs:read");

    const { id } = await params;
    const { id: missionId } = parseOrThrow(
      missionIdParamSchema,
      { id },
      "mission_id inválido: deve ser um UUID.",
    );
    const orgId = await resolveOrgScope(
      auth,
      request.nextUrl.searchParams.get("orgId"),
    );

    const job = await findJobByMissionId(missionId, orgId);
    if (!job) {
      throw HubError.notFound("Missão");
    }

    const response = await buildMissionResponse(job, missionId);
    return apiJson({ mission: response }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
