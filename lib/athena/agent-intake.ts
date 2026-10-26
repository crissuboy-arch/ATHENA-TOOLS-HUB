/**
 * Athena Tools Hub — verificação agente↔ferramenta na intake de missões.
 *
 * CONTEXTO (preparação Opção A, 26/10/2026 — decisão da proprietária):
 * a arquitetura Opção A está APROVADA (docs/ATHENA_AGENT_TOOL_SCHEMA_DECISION.md):
 * `integrations.agent_id` (migration 0012, PREPARADA — aplicação NÃO
 * autorizada) + resolução uuid→slug de `agent_tool_permissions` na intake.
 * Esta é a LIGAÇÃO que a branch anterior deliberadamente não fez: a
 * primitiva pura `checkAgentToolAccess` (agent-permissions.ts) passa a ser
 * aplicada no `POST /api/v1/athena/missions`, antes da criação do job.
 *
 * FAIL-CLOSED, SEM EXCEÇÃO E SEM DEFAULT PERMISSIVO:
 * - integração sem `agent_id` → NEGADO (`no-agent-linked`);
 * - integração ou agente desconhecido → NEGADO (`agent-unknown`);
 * - tool sem linha de permissão → NEGADO (`no-agent-permission-row`);
 * - `allowed=false` → NEGADO; capability fora de `scopes` → NEGADO;
 * - QUALQUER falha de acesso aos dados (coluna 0012 inexistente,
 *   tabela inexistente, erro de BD, Supabase não configurado) →
 *   NEGADO (`agent-schema-unavailable`) — nunca 500, nunca permitir.
 *   Erros transitórios de BD também negam: a missão falha com 403 +
 *   reason estruturado e o chamador pode tentar de novo; o que nunca
 *   acontece é um job ser criado sem verificação.
 *
 * LIMITE EXPLÍCITO (não escondido): o gate aplica-se a chamadores m2m
 * (o caminho da ATHENA). Chamadores com sessão humana (`kind: "user"`)
 * NÃO passam por esta verificação — a associação agente↔ferramenta
 * descreve identidades de máquina; sessões humanas continuam regidas
 * por RBAC de org + scope + gates de aprovação. A isenção é explícita
 * (`session-caller-not-applicable`), nunca por omissão.
 *
 * O QUE NÃO MUDA AQUI: a verificação NÃO aplica `max_cost_cents`
 * (teto por execução — fica para a contabilização de custos no worker),
 * NÃO decide aprovações (sempre humanas) e NÃO altera a decisão de
 * aprovação da missão (`resolveMissionApproval` corre depois do gate).
 */

import type { ApiAuthContext } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/auth";
import {
  checkAgentToolAccess,
  type AgentToolPermissionRow,
} from "@/lib/athena/agent-permissions";

/** Fonte de dados da verificação — injetável para testes (sem BD real). */
export interface AgentIntakeStore {
  /** Row da integração, ou null se a integração não existir. */
  getIntegrationAgentId(
    integrationId: string,
    orgId: string,
  ): Promise<{ agentId: string | null } | null>;
  agentExists(agentId: string, orgId: string): Promise<boolean>;
  listAgentPermissions(
    agentId: string,
    orgId: string,
  ): Promise<
    Array<{
      toolId: string;
      allowed: boolean;
      scopes: string[];
      maxCostCents: number;
    }>
  >;
  /** Resolve UUIDs de tools para slugs (`tools.slug`, existe desde 0001). */
  resolveToolSlugs(toolIds: string[]): Promise<Map<string, string>>;
}

export type AgentIntakeResolution =
  | { status: "resolved"; agentId: string; rows: AgentToolPermissionRow[] }
  | { status: "no-agent-linked" }
  | { status: "agent-unknown" }
  | { status: "schema-unavailable" };

export type AgentToolGateReason =
  | "allowed"
  | "no-agent-permission-row"
  | "agent-tool-not-allowed"
  | "capability-not-allowed"
  | "no-agent-linked"
  | "agent-unknown"
  | "agent-schema-unavailable"
  | "session-caller-not-applicable";

export interface AgentToolGateDecision {
  allowed: boolean;
  reason: AgentToolGateReason;
}

/**
 * Decisão pura sobre uma resolução já obtida. Nunca permite por omissão:
 * todos os estados que não são "resolved + allowed" negam.
 */
export function authorizeAgentToolAccess(
  resolution: AgentIntakeResolution,
  toolSlug: string,
  capability?: string,
): AgentToolGateDecision {
  switch (resolution.status) {
    case "resolved": {
      const decision = checkAgentToolAccess(
        resolution.rows,
        toolSlug,
        capability,
      );
      return { allowed: decision.allowed, reason: decision.reason };
    }
    case "no-agent-linked":
      return { allowed: false, reason: "no-agent-linked" };
    case "agent-unknown":
      return { allowed: false, reason: "agent-unknown" };
    case "schema-unavailable":
      return { allowed: false, reason: "agent-schema-unavailable" };
  }
}

/**
 * Resolve o agente da integração e as suas permissões (com uuid→slug).
 * QUALQUER exceção da store vira `schema-unavailable` — incluindo a
 * coluna `agent_id` inexistente (0012 ainda não aplicada) — nunca um
 * crash aberto nem uma permissão.
 */
export async function resolveAgentToolAccess(
  store: AgentIntakeStore,
  input: { integrationId: string; orgId: string },
): Promise<AgentIntakeResolution> {
  try {
    const integration = await store.getIntegrationAgentId(
      input.integrationId,
      input.orgId,
    );
    if (integration === null) return { status: "agent-unknown" };
    if (integration.agentId === null) return { status: "no-agent-linked" };
    const exists = await store.agentExists(integration.agentId, input.orgId);
    if (!exists) return { status: "agent-unknown" };
    const permissions = await store.listAgentPermissions(
      integration.agentId,
      input.orgId,
    );
    const slugs = await store.resolveToolSlugs(
      permissions.map((p) => p.toolId),
    );
    const rows: AgentToolPermissionRow[] = [];
    for (const p of permissions) {
      const slug = slugs.get(p.toolId);
      // tool_id sem slug resolvível nunca casa com nenhuma tool: a linha
      // é descartada (negar por ausência) em vez de inventar um slug.
      if (slug) {
        rows.push({
          toolSlug: slug,
          allowed: p.allowed,
          scopes: p.scopes,
          maxCostCents: p.maxCostCents,
        });
      }
    }
    return { status: "resolved", agentId: integration.agentId, rows };
  } catch {
    return { status: "schema-unavailable" };
  }
}

/** Adaptador Supabase real (server-side, service role). */
export function supabaseAgentIntakeStore(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): AgentIntakeStore {
  return {
    async getIntegrationAgentId(integrationId, orgId) {
      const { data, error } = await supabase
        .from("integrations")
        .select("agent_id")
        .eq("id", integrationId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(`integrations lookup failed: ${error.message}`);
      if (!data) return null;
      return { agentId: (data as { agent_id: string | null }).agent_id };
    },
    async agentExists(agentId, orgId) {
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("id", agentId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(`agents lookup failed: ${error.message}`);
      return data !== null;
    },
    async listAgentPermissions(agentId, orgId) {
      const { data, error } = await supabase
        .from("agent_tool_permissions")
        .select("tool_id, allowed, scopes, max_cost_cents")
        .eq("agent_id", agentId)
        .eq("org_id", orgId);
      if (error) {
        throw new Error(`agent_tool_permissions lookup failed: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        toolId: (row as { tool_id: string }).tool_id,
        allowed: (row as { allowed: boolean }).allowed,
        scopes: ((row as { scopes: string[] | null }).scopes ?? []) as string[],
        maxCostCents:
          ((row as { max_cost_cents: number | null }).max_cost_cents ?? 0) as number,
      }));
    },
    async resolveToolSlugs(toolIds) {
      if (toolIds.length === 0) return new Map<string, string>();
      const { data, error } = await supabase
        .from("tools")
        .select("id, slug")
        .in("id", toolIds);
      if (error) throw new Error(`tools lookup failed: ${error.message}`);
      return new Map(
        (data ?? []).map((row) => [
          (row as { id: string }).id,
          (row as { slug: string }).slug,
        ]),
      );
    },
  };
}

/**
 * Ponto de entrada da rota: decide se a missão pode avançar para a
 * criação do job. Chamadores m2m passam pela resolução real; qualquer
 * falha (incluindo Supabase não configurado) nega — nunca 500.
 */
export async function authorizeMissionToolAccess(
  auth: ApiAuthContext,
  toolSlug: string,
): Promise<AgentToolGateDecision> {
  if (auth.kind !== "m2m") {
    return { allowed: true, reason: "session-caller-not-applicable" };
  }
  try {
    const store = supabaseAgentIntakeStore(getSupabaseAdmin());
    const resolution = await resolveAgentToolAccess(store, {
      integrationId: auth.integrationId,
      orgId: auth.orgId,
    });
    return authorizeAgentToolAccess(resolution, toolSlug);
  } catch {
    return { allowed: false, reason: "agent-schema-unavailable" };
  }
}
