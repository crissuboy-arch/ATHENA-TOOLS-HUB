/**
 * GET /api/v1/jobs/[id]/events?orgId= — linha do tempo de execução do job
 * (transições de estado, notas). Scope jobs:read.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getJobEvents } from "@/lib/jobs/service";

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
    const orgId = await resolveOrgScope(
      auth,
      request.nextUrl.searchParams.get("orgId"),
    );
    const events = await getJobEvents(id, orgId);

    return apiJson({ events }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
