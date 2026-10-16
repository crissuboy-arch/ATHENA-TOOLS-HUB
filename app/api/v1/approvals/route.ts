/**
 * GET /api/v1/approvals?orgId=&page=&perPage= — fila de jobs aguardando
 * decisão humana (PENDING_APPROVAL). Scope approvals:decide.
 */

import type { NextRequest } from "next/server";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import { authenticate, requireScope, resolveOrgScope } from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { listJobs } from "@/lib/jobs/service";
import { paginationSchema, parseOrThrow, uuidSchema } from "@/lib/validators";

const approvalsQuerySchema = paginationSchema.extend({ orgId: uuidSchema });

export async function GET(request: NextRequest) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const auth = await authenticate(request);
    requireScope(auth, "approvals:decide");

    const query = parseOrThrow(
      approvalsQuerySchema,
      Object.fromEntries(request.nextUrl.searchParams.entries()),
      "Parâmetros de consulta inválidos.",
    );
    const orgId = await resolveOrgScope(auth, query.orgId);

    const result = await listJobs({
      orgId,
      status: "PENDING_APPROVAL",
      page: query.page,
      perPage: query.perPage,
    });

    return apiJson(result, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
