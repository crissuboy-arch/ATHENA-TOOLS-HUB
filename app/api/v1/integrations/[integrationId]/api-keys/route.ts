/**
 * Gestão de chaves de API de uma integração — FASE 2D (C5).
 *
 *   POST /api/v1/integrations/{integrationId}/api-keys — emitir
 *   GET  /api/v1/integrations/{integrationId}/api-keys — listar metadados
 *
 * Acesso: EXCLUSIVAMENTE sessão humana com papel owner/admin na org dona
 * da integração (`requireSessionUser` + `resolveOrgScope`). Chaves de API
 * recebem 403 — nem as próprias credenciais uma chave pode gerir.
 *
 * A emissão devolve a chave crua e o segredo de assinatura (Opção A)
 * UMA ÚNICA VEZ, nesta resposta; a BD guarda só o hash e a referência
 * do segredo. Expiração por omissão: 90 dias (decisão ratificada).
 * Scopes por omissão: os três operacionais (tools:read, jobs:read,
 * jobs:write) — `approvals:decide` só quando pedido explicitamente, e
 * mesmo assim nunca decide aprovações (C4: decisão é só humana).
 *
 * Pré-0011 (tabela inexistente): 501 honesto — ver lib/api-keys-admin.ts.
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
import {
  API_KEY_DEFAULT_TTL_DAYS,
  issueApiKey,
  listApiKeys,
  loadIntegration,
  type IntegrationRef,
} from "@/lib/api-keys-admin";

const integrationIdParamSchema = z.object({ integrationId: uuidSchema });

const issueBodySchema = z.object({
  label: z.string().min(1, "label é obrigatório.").max(120),
  scopes: z
    .array(
      z.enum(["tools:read", "jobs:read", "jobs:write", "approvals:decide"]),
    )
    .min(1, "Informe ao menos um scope.")
    .max(4)
    .optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  withSigningSecret: z.boolean().optional(),
  replacesKeyId: uuidSchema.optional(),
});

const DEFAULT_SCOPES = ["tools:read", "jobs:read", "jobs:write"] as const;

/**
 * Autentica e autoriza a gestão: sessão humana + owner/admin na org da
 * integração (a org vem da LINHA da integração, nunca de um parâmetro —
 * ninguém gere chaves apontando para a org de outra pessoa).
 */
async function authorizeKeyManagement(
  request: NextRequest,
  integrationId: string,
): Promise<{ integration: IntegrationRef; userId: string }> {
  const auth = await authenticate(request);
  requireSessionUser(auth);
  const integration = await loadIntegration(integrationId);
  if (!integration) throw HubError.notFound("Integração");
  await resolveOrgScope(auth, integration.orgId, ["owner", "admin"]);
  return { integration, userId: auth.userId };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const { integrationId } = parseOrThrow(
      integrationIdParamSchema,
      await params,
      "integrationId inválido.",
    );
    const { integration, userId } = await authorizeKeyManagement(
      request,
      integrationId,
    );
    const body = parseOrThrow(
      issueBodySchema,
      await request.json().catch(() => null),
      "Corpo inválido.",
    );

    const scopes = body.scopes
      ? [...new Set(body.scopes)]
      : [...DEFAULT_SCOPES];

    const issued = await issueApiKey({
      integration,
      label: body.label,
      scopes,
      expiresInDays: body.expiresInDays ?? API_KEY_DEFAULT_TTL_DAYS,
      withSigningSecret: body.withSigningSecret,
      replacesKeyId: body.replacesKeyId,
      actorUserId: userId,
    });

    const { rawKey, signingSecret, ...apiKey } = issued;
    return apiJson(
      { apiKey, rawKey, signingSecret },
      { requestId, status: 201, headers: rl.headers },
    );
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ integrationId: string }> },
) {
  const requestId = newRequestId();
  const rl = checkRateLimit(rateLimitIdentity(request));
  try {
    if (!rl.allowed) {
      throw new HubError("RATE_LIMITED", "Limite de requisições excedido.", 429);
    }
    const { integrationId } = parseOrThrow(
      integrationIdParamSchema,
      await params,
      "integrationId inválido.",
    );
    const { integration } = await authorizeKeyManagement(
      request,
      integrationId,
    );
    const apiKeys = await listApiKeys(integration);
    return apiJson({ apiKeys }, { requestId, headers: rl.headers });
  } catch (err) {
    return apiError(err, requestId, rl.headers);
  }
}
