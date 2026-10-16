/**
 * /api/v1/jobs
 * GET  — lista paginada/filtrada de jobs da org (scope jobs:read)
 * POST — cria um job com idempotência (scope jobs:write)
 *        body: { orgId, toolId, params, idempotencyKey? }
 *        ou header Idempotency-Key como alternativa a idempotencyKey.
 *        201 = criado · 200 + deduplicated:true = replay idempotente.
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
import { createJob, listJobs } from "@/lib/jobs/service";
import { jobQuerySchema, parseOrThrow } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const auth = await authenticate(request);
    requireScope(auth, "jobs:read");

    const query = parseOrThrow(
      jobQuerySchema,
      Object.fromEntries(request.nextUrl.searchParams.entries()),
      "Parâmetros de consulta inválidos.",
    );
    const orgId = await resolveOrgScope(auth, query.orgId);
    const result = await listJobs({ ...query, orgId });

    return apiJson(result, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}

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
    // Header Idempotency-Key como alternativa ao campo do body.
    const headerKey = request.headers.get("idempotency-key");
    const input: Record<string, unknown> = {
      ...body,
      ...(headerKey && !body.idempotencyKey ? { idempotencyKey: headerKey } : {}),
    };

    // Validação antecipada de org/scope antes de tocar o service.
    const orgIdParam =
      typeof input.orgId === "string" ? input.orgId : undefined;
    const orgId = await resolveOrgScope(auth, orgIdParam);

    const { job, created } = await createJob(
      { ...input, orgId },
      actorOf(auth),
    );

    return apiJson(
      { job, deduplicated: !created },
      { requestId, status: created ? 201 : 200, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
