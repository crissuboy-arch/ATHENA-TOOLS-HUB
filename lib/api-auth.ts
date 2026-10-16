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

export type ApiScope = "tools:read" | "jobs:read" | "jobs:write" | "approvals:decide";

export type ApiAuthContext =
  | { kind: "user"; userId: string }
  | { kind: "m2m"; orgId: string; scopes: ApiScope[]; integrationId: string };

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
    // Anti-replay obrigatório para chaves de API.
    checkReplayProtection(request.headers, sha256Hex(token));
    return {
      kind: "m2m",
      orgId: identity.orgId,
      scopes: identity.scopes as ApiScope[],
      integrationId: identity.integrationId,
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
