/**
 * Athena Tools Hub — associação de ferramentas a agentes autorizados.
 *
 * CONTEXTO (auditoria ATHENA CONNECT, 2026-10-26):
 * o schema JÁ tem a associação — `agent_tool_permissions`
 * (`supabase/migrations/0008_agents_missions.sql`: agent_id + tool_id +
 * allowed + scopes + max_cost_cents, único por (agent_id, tool_id)) — mas
 * NENHUM código a lia ou aplicava (só `lib/db-types.ts` a tipava). As
 * rotas de missões/jobs autorizavam apenas por scope da chave
 * (`jobs:write`), sem verificar se o agente podia usar aquela tool.
 *
 * O QUE ISTO É: a primitiva PURA de decisão (fail-closed), testável sem
 * banco. O que NÃO é (limite honesto, a decidir pela proprietária e
 * pelo Cláudio antes de ligar na intake de missões):
 * - `agent_tool_permissions.tool_id` é um UUID da tabela `tools`, NÃO o
 *   slug (`vectorcraft`, …) que as missões usam. Quem chama esta função
 *   tem de resolver uuid→slug primeiro; esta função recebe linhas JÁ
 *   resolvidas (`toolSlug`).
 * - NÃO existe vínculo integração↔agente: a tabela `integrations` não
 *   tem `agent_id`, e a identidade m2m carrega só `integrationId` +
 *   `orgId` (ver `lib/api-auth.ts`). Sem esse vínculo, a intake de
 *   missões NÃO consegue saber QUE agente uma chave representa — ligar
 *   esta verificação lá hoje negaria tudo ou permitiria tudo, conforme
 *   o default escolhido. Por isso a verificação vive, por agora, na
 *   descoberta (anotação) e nos testes, e a sua ligação à intake é
 *   trabalho pendente listado no relatório (decisão de schema).
 *
 * REGRAS FAIL-CLOSED (nenhum default permissivo):
 * - sem linha para a tool → NEGADO (`no-agent-permission-row`);
 * - linha com allowed=false → NEGADO;
 * - scopes não vazios e capability pedida fora deles → NEGADO;
 * - scopes vazios = todas as capabilities da tool (regra do schema).
 */

export interface AgentToolPermissionRow {
  /** Slug da tool, JÁ resolvido a partir de tools.id (ver nota acima). */
  toolSlug: string;
  allowed: boolean;
  /** Nomes de capabilities permitidas; vazio = todas. */
  scopes: string[];
  /** Teto por execução em cêntimos; 0 = sem teto definido. */
  maxCostCents: number;
}

export interface AgentToolAccessDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "no-agent-permission-row"
    | "agent-tool-not-allowed"
    | "capability-not-allowed";
  scopes: string[];
  maxCostCents: number;
}

/**
 * Decide se um agente pode usar uma tool (e, opcionalmente, uma
 * capability dela). Pura — recebe as linhas já resolvidas.
 */
export function checkAgentToolAccess(
  rows: AgentToolPermissionRow[],
  toolSlug: string,
  capability?: string,
): AgentToolAccessDecision {
  const row = rows.find((r) => r.toolSlug === toolSlug);
  if (!row) {
    return {
      allowed: false,
      reason: "no-agent-permission-row",
      scopes: [],
      maxCostCents: 0,
    };
  }
  if (!row.allowed) {
    return {
      allowed: false,
      reason: "agent-tool-not-allowed",
      scopes: row.scopes,
      maxCostCents: row.maxCostCents,
    };
  }
  if (
    capability !== undefined &&
    row.scopes.length > 0 &&
    !row.scopes.includes(capability)
  ) {
    return {
      allowed: false,
      reason: "capability-not-allowed",
      scopes: row.scopes,
      maxCostCents: row.maxCostCents,
    };
  }
  return {
    allowed: true,
    reason: "allowed",
    scopes: row.scopes,
    maxCostCents: row.maxCostCents,
  };
}

/** Atalho usado pela descoberta: só a linha resolvida, sem capability. */
export function resolveAgentToolPermission(
  rows: AgentToolPermissionRow[],
  toolSlug: string,
): AgentToolPermissionRow | null {
  return rows.find((r) => r.toolSlug === toolSlug) ?? null;
}
