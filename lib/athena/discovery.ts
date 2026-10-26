/**
 * Athena Tools Hub — descoberta de ferramentas pela ATHENA Control.
 *
 * PROBLEMA QUE ISTO RESOLVE (auditoria ATHENA CONNECT, 2026-10-26):
 * a Athena só tinha duas formas de conhecer tools — `GET /api/v1/tools`
 * (linhas da tabela `tools` por org, 503 sem Supabase configurado) e
 * `GET /api/v1/tools/[id]` (cujo fallback de contrato em código era
 * INALCANÇÁVEL sem Supabase: o `throw notConfigured()` corria antes
 * dele). Não existia um contrato de descoberta pensado para a Athena:
 * tool + capabilities + estado de integração + requisito de aprovação +
 * executor — numa só resposta, legível com o scope `tools:read`.
 *
 * O QUE ISTO É (e não é):
 * - É a união, em código, de (a) adapters registrados em
 *   `lib/adapters/index.ts` e (b) entradas do catálogo
 *   (`lib/catalog/tools.ts`). Nada aqui lê o banco: a descoberta descreve
 *   CONTRATOS, não linhas por org — por isso a rota
 *   `GET /api/v1/athena/tools` não exige Supabase configurado (a
 *   autenticação e o vínculo à org continuam exigidos na rota).
 * - NÃO é execução: `executionReady` é false em TODOS os adapters reais
 *   (2026-10-26) e `integrationStatus` é, por isso, sempre "pending".
 *   Um job criado para qualquer destas tools fica QUEUED (ou
 *   PENDING_APPROVAL) e nunca "succeeds" sem executor real — ver
 *   `lib/jobs/worker.ts`. Nenhum resultado é simulado aqui.
 * - NÃO é autorização por agente: o campo `agentPermission` só é
 *   preenchido quando o chamador entrega linhas de
 *   `agent_tool_permissions` JÁ RESOLVIDAS para slugs (ver
 *   `lib/athena/agent-permissions.ts`). Sem vínculo agente↔integração
 *   no schema (a tabela `integrations` não tem `agent_id`), a rota
 *   devolve `agentPermission: null` com a nota honesta
 *   `agent_link: "not-configured"` — nunca uma permissão inventada.
 */

import { toolRegistry } from "../adapters/index";
import { TOOLS, getTool } from "../catalog/tools";
import type { AgentToolPermissionRow } from "./agent-permissions";
import { resolveAgentToolPermission } from "./agent-permissions";

export type AthenaIntegrationStatus = "ready" | "pending";

export interface AthenaToolDiscoveryEntry {
  id: string;
  name: string;
  description: string | null;
  /** Capabilities declaradas (adapter quando existe, senão catálogo). */
  capabilities: string[];
  /** Estado legado do catálogo, quando a tool existe nele. */
  catalogState: string | null;
  /** "ready" só com executor real conectado; hoje sempre "pending". */
  integrationStatus: AthenaIntegrationStatus;
  executionReady: boolean;
  /** Contrato da tool decide; tool sem adapter = exige aprovação. */
  requiresApproval: boolean;
  estimatedCost: string | null;
  /** Inputs do contrato, quando o catálogo os especifica; senão null. */
  inputs: Array<{
    name: string;
    type: string;
    required: boolean;
    note: string | null;
  }> | null;
  /** De onde veio esta entrada: adapter, catálogo, ou ambos. */
  source: "adapter" | "catalog" | "adapter+catalog";
  /**
   * Permissão agente↔tool resolvida, quando fornecida. null = nenhum
   * vínculo resolvido para o chamador — NÃO significa "permitido".
   */
  agentPermission: {
    allowed: boolean;
    scopes: string[];
    maxCostCents: number;
  } | null;
}

/**
 * Constrói a lista de descoberta. Pura (sem I/O) e, por isso, testável
 * sem banco, sem sessão e sem executores.
 */
export function buildAthenaToolDiscovery(
  permissionRows?: AgentToolPermissionRow[],
): AthenaToolDiscoveryEntry[] {
  const ids = new Set<string>();
  for (const adapter of toolRegistry.list()) ids.add(adapter.id);
  for (const tool of TOOLS) ids.add(tool.id);

  const entries: AthenaToolDiscoveryEntry[] = [];
  for (const id of [...ids].sort()) {
    const adapter = toolRegistry.adapterFor(id);
    const catalog = getTool(id);
    const dryRun = adapter?.dryRunInfo();
    const resolved = permissionRows
      ? resolveAgentToolPermission(permissionRows, id)
      : null;
    entries.push({
      id,
      name: catalog?.name ?? id,
      description: catalog?.description ?? null,
      capabilities: adapter?.capabilities ?? catalog?.capabilities ?? [],
      catalogState: catalog?.state ?? null,
      integrationStatus: adapter?.executionReady ? "ready" : "pending",
      executionReady: adapter?.executionReady ?? false,
      requiresApproval: dryRun ? dryRun.requiresApproval : true,
      estimatedCost: dryRun?.estimatedCost ?? null,
      inputs: catalog?.io?.inputs
        ? catalog.io.inputs.map((i) => ({
            name: i.name,
            type: i.type,
            required: i.required,
            note: i.note ?? null,
          }))
        : null,
      source: adapter && catalog
        ? "adapter+catalog"
        : adapter
          ? "adapter"
          : "catalog",
      agentPermission: resolved
        ? {
            allowed: resolved.allowed,
            scopes: resolved.scopes,
            maxCostCents: resolved.maxCostCents,
          }
        : null,
    });
  }
  return entries;
}

/** Resumo de execução honesto para a Athena: quantas prontas vs pendentes. */
export function discoveryExecutionSummary(
  entries: AthenaToolDiscoveryEntry[],
): { ready: number; pending: number; total: number } {
  const ready = entries.filter((e) => e.executionReady).length;
  return { ready, pending: entries.length - ready, total: entries.length };
}
