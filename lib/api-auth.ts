/**
 * Athena Tools Hub — autenticação unificada para /api/v1.
 *
 * Dois modos, avaliados nesta ordem:
 *   1. Machine-to-machine: `Authorization: Bearer <api key>` + proteções
 *      anti-replay (X-Request-Timestamp, X-Nonce). Identidade vinculada a
 *      UMA org e a scopes (tools:read, jobs:read, jobs:write, approvals:decide).
 *   2. Sessão de usuário: cookie de sessão Supabase. A org vem do parâmetro
 *      `orgId` e o vínculo é verificado via memberships (RBAC).
 *
 * Sem nenhum dos dois → 401. Scope insuficiente → 403.
 */

import type { NextRequest } from "next/server";
import { HubError } from "./errors";
import { getSession, requireOrgRole, type OrgRole } from "./auth";
import { checkReplayProtection, sha256Hex, verifyApiKey } from "./api-keys";
import { enforceM2mTransportSecurity } from "./api-signing";

export type ApiScope = "tools:read" | "jobs:read" | "jobs:write" | "approvals:decide";

export type ApiAuthContext =
  | { kind: "user"; userId: string }
  | {
      kind: "m2m";
      orgId: string;
      scopes: ApiScope[];
      integrationId: string;
      /** FASE 2D — presente quando a chave vive na tabela `api_keys`. */
      apiKeyId?: string;
    };

function bearerToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1].trim() : null;
}

/** Autentica a requisição (m2m ou sessão). Lança 401 se inválida. */
export async function authenticate(request: NextRequest): Promise<ApiAuthContext> {
  const token = bearerToken(request);
  if (token) {
    const identity = await verifyApiKey(token);
    if (!identity) {
      throw HubError.unauthorized("Chave de API inválida ou inativa.");
    }
    const fingerprint = sha256Hex(token);
    if (identity.apiKeyId) {
      // FASE 2D (C3): chave da tabela api_keys — timestamp → assinatura
      // HMAC → nonce persistente (com degradação honesta pré-0011).
      await enforceM2mTransportSecurity(request, identity, fingerprint);
    } else {
      // Caminho legado: anti-replay em memória (comportamento intacto).
      checkReplayProtection(request.headers, fingerprint);
    }
    return {
      kind: "m2m",
      orgId: identity.orgId,
      scopes: identity.scopes as ApiScope[],
      integrationId: identity.integrationId,
      apiKeyId: identity.apiKeyId,
    };
  }

  const session = await getSession();
  if (!session) {
    throw HubError.unauthorized(
      "Autenticação necessária: Bearer <api key> ou sessão válida.",
    );
  }
  return { kind: "user", userId: session.user.id };
}

/**
 * FASE 2B (C4) — decisões de aprovação são EXCLUSIVAMENTE humanas.
 *
 * Antes, a regra "máquinas não decidem aprovações" era apenas documental
 * (docs/ATHENA_MANUAL.md §3 recomendava não conceder o scope): uma chave
 * m2m COM `approvals:decide` conseguia aprovar/rejeitar jobs — inclusive
 * os que ela própria criou (bloqueio B4 da Fase 1). Agora é código: este
 * guarda corre na rota de decisão ANTES de qualquer outra verificação e
 * recusa qualquer contexto que não seja sessão de usuário. O papel
 * (owner/admin) continua a ser exigido a seguir, via
 * `resolveOrgScope(auth, orgId, ["owner", "admin"])`.
 *
 * O scope `approvals:decide` continua válido para LEITURA da fila
 * (GET /api/v1/approvals) — máquinas podem consultar; decidir, não.
 */
export function requireHumanSession(
  ctx: ApiAuthContext,
): asserts ctx is Extract<ApiAuthContext, { kind: "user" }> {
  if (ctx.kind !== "user") {
    throw HubError.forbidden(
      "Decisões de aprovação exigem sessão humana (owner/admin). Chaves de API não podem aprovar nem rejeitar jobs, mesmo com o scope approvals:decide.",
    );
  }
}

/**
 * FASE 2D (C5) — gestão de credenciais é EXCLUSIVA de sessões humanas:
 * nenhuma chave de API emite, lista ou revoga chaves (nem as suas). É o
 * mesmo princípio da C4 aplicado à gestão de chaves: se uma chave pudesse
 * emitir chaves, uma credencial comprometida reproduzia-se. O papel
 * (owner/admin na org da integração) é exigido a seguir, via
 * `resolveOrgScope`, como nas decisões de aprovação.
 */
export function requireSessionUser(
  ctx: ApiAuthContext,
): asserts ctx is Extract<ApiAuthContext, { kind: "user" }> {
  if (ctx.kind !== "user") {
    throw HubError.forbidden(
      "Gestão de chaves de API exige sessão humana (owner/admin). Chaves de API não podem emitir, listar nem revogar credenciais.",
    );
  }
}

/** Exige um scope. Para sessão de usuário, o RBAC é verificado por org (resolveOrgScope). */
export function requireScope(ctx: ApiAuthContext, scope: ApiScope): void {
  if (ctx.kind === "m2m" && !ctx.scopes.includes(scope)) {
    throw HubError.forbidden(`Scope insuficiente. Necessário: ${scope}.`);
  }
}

const ALL_ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];

/**
 * Resolve a org em escopo:
 * - m2m: a org é a da chave. Se `orgId` vier no request e divergir → 403.
 * - user: `orgId` é obrigatório e o membership é verificado.
 */
export async function resolveOrgScope(
  ctx: ApiAuthContext,
  orgIdParam: string | null | undefined,
  roles: OrgRole[] = ALL_ROLES,
): Promise<string> {
  if (ctx.kind === "m2m") {
    if (orgIdParam && orgIdParam !== ctx.orgId) {
      throw HubError.forbidden(
        "A chave de API não tem acesso a esta organização.",
      );
    }
    return ctx.orgId;
  }
  if (!orgIdParam) {
    throw HubError.validation("Parâmetro orgId é obrigatório.");
  }
  await requireOrgRole(orgIdParam, roles);
  return orgIdParam;
}

/** Identidade do ator para auditoria. */
export function actorOf(ctx: ApiAuthContext): { id: string; type: "user" | "api_key" } {
  return ctx.kind === "user"
    ? { id: ctx.userId, type: "user" }
    : { id: ctx.integrationId, type: "api_key" };
}
