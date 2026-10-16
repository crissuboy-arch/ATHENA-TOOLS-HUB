/**
 * POST /api/v1/jobs/[id]/cancel — cancela um job não-terminal.
 * body: { orgId, reason? }. Scope jobs:write.
 * Estados terminais → 409 INVALID_TRANSITION.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import {
  actorOf,
  authenticate,
  requireScope,
  resolveOrgScope,
} from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { cancelJob } from "@/lib/jobs/service";
import { parseOrThrow, uuidSchema } from "@/lib/validators";

const cancelBodySchema = z.object({
  orgId: uuidSchema,
  reason: z.string().max(500).optional(),
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
    requireScope(auth, "jobs:write");

    const { id } = await params;
    const body = parseOrThrow(
      cancelBodySchema,
      await request.json().catch(() => null),
      "Corpo inválido.",
    );
    const orgId = await resolveOrgScope(auth, body.orgId);

    const job = await cancelJob(id, orgId, actorOf(auth), body.reason);

    return apiJson({ job }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
