/**
 * GET /api/v1/jobs/[id]/assets?orgId= — assets produzidos pelo job
 * (URLs de download, previews). Scope jobs:read.
 * Vazio honesto enquanto o job não produziu nada — nunca inventado.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { getJobAssets } from "@/lib/jobs/service";

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
    const assets = await getJobAssets(id, orgId);

    return apiJson({ assets }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
