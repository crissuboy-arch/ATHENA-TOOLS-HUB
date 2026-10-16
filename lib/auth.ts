/**
 * Athena Tools Hub — autenticação de sessão (Supabase) e RBAC por organização.
 *
 * Os helpers de cliente Supabase vêm de `@/lib/supabase` (fonte única):
 * `isSupabaseConfigured`, `createServerClient` (async, Next.js 16),
 * `createServiceClient`. Este módulo adiciona a camada de sessão/RBAC.
 *
 * Degradação honesta: sem env vars do Supabase, tudo aqui lança
 * HubError SUPABASE_NOT_CONFIGURED (503) — nunca finge autenticar.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HubError } from "./errors";
import {
  createServerClient,
  createServiceClient,
  isSupabaseConfigured,
} from "./supabase";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface OrgMembership {
  orgId: string;
  role: OrgRole;
  orgName?: string;
}

export { isSupabaseConfigured };

/**
 * Cliente server-side vinculado à sessão do usuário (cookies).
 * Re-export de @/lib/supabase (Next.js 16: `cookies()` é async).
 */
export const getSupabaseServerClient: () => Promise<SupabaseClient> =
  createServerClient;

/** Cliente com service role — SOMENTE server-side, nunca exposto ao client. */
export function getSupabaseAdmin(): SupabaseClient {
  try {
    return createServiceClient();
  } catch {
    throw HubError.notConfigured("SUPABASE_SERVICE_ROLE_KEY");
  }
}

/** Sessão/usuário atual via cookie. Retorna null se não autenticado. */
export async function getSession(): Promise<{ user: User } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { user };
}

/** Exige usuário autenticado; lança 401 caso contrário. */
export async function requireUser(): Promise<User> {
  const session = await getSession();
  if (!session) throw HubError.unauthorized("Sessão inválida ou expirada. Faça login.");
  return session.user;
}

/**
 * Organizações do usuário atual com seus papéis.
 * Tabela: `organization_members(user_id, org_id, role)` com join em
 * `organizations(id, name)`.
 */
export async function getUserOrganizations(): Promise<OrgMembership[]> {
  const user = await requireUser();
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("org_id, role, organizations(id, name)")
    .eq("user_id", user.id);
  if (error) {
    throw new HubError("INTERNAL", "Não foi possível carregar as organizações.", 500);
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    orgId: row.org_id as string,
    role: row.role as OrgRole,
    orgName: (row.organizations as { name?: string } | null)?.name,
  }));
}

/**
 * Exige que o usuário atual tenha um dos papéis na organização.
 * Retorna o papel efetivo. Lança 403 se não for membro / papel insuficiente.
 */
export async function requireOrgRole(
  orgId: string,
  roles: OrgRole[],
): Promise<OrgRole> {
  const user = await requireUser();
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    throw new HubError("INTERNAL", "Não foi possível verificar o papel.", 500);
  }
  const role = (data as { role?: OrgRole } | null)?.role;
  if (!role || !roles.includes(role)) {
    throw HubError.forbidden(
      "Você não tem permissão para esta organização/ação.",
    );
  }
  return role;
}
