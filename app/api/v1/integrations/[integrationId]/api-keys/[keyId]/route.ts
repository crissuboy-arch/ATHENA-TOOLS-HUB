/**
 * DELETE /api/v1/integrations/{integrationId}/api-keys/{keyId} — revogar.
 *
 * FASE 2D (C5). Acesso: EXCLUSIVAMENTE sessão humana owner/admin na org
 * dona da integração (mesmo padrão da emissão). Chaves de API → 403.
 * Revogação é imediata (o lookup de autenticação filtra revoked_at) e
 * irreversível; a operação é idempotente (revogar duas vezes devolve os
 * mesmos metadados, sem erro). Chave de outra integração/org → 404.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { HubError, newRequestId } from "@/lib/errors";
import { apiError, apiJson } from "@/lib/api-response";
import {
  authenticate,
  requireSessionUser,
  resolveOrgScope,
} from "@/lib/api-auth";
import { checkRateLimit, rateLimitIdentity } from "@/lib/rate-limit";
import { parseOrThrow, uuidSchema } from "@/lib/validators";
import { loadIntegration, revokeApiKey } from "@/lib/api-keys-admin";

const paramsSchema = z.object({
  integrationId: uuidSchema,
  keyId: uuidSchema,
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ integrationId: string; keyId: string }> },
) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const { integrationId, keyId } = parseOrThrow(
      paramsSchema,
      await params,
      "Parâmetros inválidos.",
    );

    const auth = await authenticate(request);
    // Gestão de credenciais é humana (C5): chave de API → 403.
    requireSessionUser(auth);

    const integration = await loadIntegration(integrationId);
    if (!integration) throw HubError.notFound("Integração");
    await resolveOrgScope(auth, integration.orgId, ["owner", "admin"]);

    const apiKey = await revokeApiKey({
      integration,
      keyId,
      actorUserId: auth.userId,
    });

    return apiJson({ apiKey }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
