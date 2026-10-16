/**
 * GET /api/v1/jobs/[id]?orgId= — detalhe do job (scope jobs:read).
 * Inclui integrationStatus honesto: 'pending' sem executor real.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getJob } from "@/lib/jobs/service";

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
    const job = await getJob(id, orgId);

    return apiJson({ job }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
