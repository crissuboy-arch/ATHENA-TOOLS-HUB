/**
 * Athena Tools Hub — autenticação de sessão (Supabase) e RBAC por organização.
 *
 * NOTA DE REFATORAÇÃO: os helpers de cliente Supabase abaixo
 * (`isSupabaseConfigured`, `getSupabaseServerClient`, `getSupabaseAdmin`)
 * estão definidos localmente porque `lib/supabase` (responsabilidade do
 * agente de DB) ainda não existe neste branch. Quando `lib/supabase` for
 * entregue, estas funções devem virar re-exports dele — a API pública deste
 * módulo (`getSession`, `requireUser`, `requireOrgRole`,
 * `getUserOrganizations`) permanece a mesma.
 *
 * Degradação honesta: sem env vars do Supabase, tudo aqui lança
 * HubError SUPABASE_NOT_CONFIGURED (503) — nunca finge autenticar.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { HubError } from "./errors";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface OrgMembership {
  orgId: string;
  role: OrgRole;
  orgName?: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True quando há projeto Supabase configurado via env vars. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

function assertConfigured(): void {
  if (!isSupabaseConfigured()) throw HubError.notConfigured();
}

/**
 * Cliente server-side vinculado à sessão do usuário (cookies).
 * Next.js 16: `cookies()` é async.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  assertConfigured();
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Chamado de Server Component sem permissão de escrita —
          // o refresh é tratado pelo proxy/route handler.
        }
      },
    },
  });
}

/** Cliente com service role — SOMENTE server-side, nunca exposto ao client. */
export function getSupabaseAdmin(): SupabaseClient {
  assertConfigured();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw HubError.notConfigured("SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
 * Tabela esperada (agente de DB): `memberships(user_id, org_id, role)`
 * com join em `organizations(id, name)`.
 */
export async function getUserOrganizations(): Promise<OrgMembership[]> {
  const user = await requireUser();
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
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
    .from("memberships")
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
