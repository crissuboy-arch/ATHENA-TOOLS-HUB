/**
 * ATHENA TOOLS HUB — saúde honesta das ferramentas do catálogo (FASE 4).
 *
 * O estado de saúde de uma ferramenta DERIVA DE EVIDÊNCIA, nunca de
 * declaração:
 *   (a) adapter registrado no toolRegistry? (lib/adapters — esqueletos 501
 *       têm executionReady = false)
 *   (b) configurado? (credenciais/config necessária presente — injetado pelo
 *       chamador via overrides, pois o Hub ainda não tem cofre/store real)
 *   (c) última execução real com sucesso? (histórico — injetado via overrides;
 *       sem histórico, o teto é CONNECTED)
 *
 * Regras duras:
 * - CONNECTED ≠ READY. READY exige execução funcional real comprovada.
 * - Adapter 501 (executionReady = false) NUNCA resulta em READY.
 * - Nada é inventado: sem evidência de (b) ou (c), o estado cai para
 *   NOT_CONFIGURED.
 */

import { toolRegistry } from "../adapters";
import {
  mapLegacyStateToHealth,
  type ToolEntry,
  type ToolHealthState,
} from "./types";
import { getTool } from "./tools";

/** Sinais observáveis usados para derivar o estado de saúde. */
export interface ToolHealthSignals {
  /** Adapter registrado em lib/adapters (mesmo que esqueleto 501). */
  adapterRegistered: boolean;
  /** adapter.executionReady — true SOMENTE com executor real validado. */
  executionReady: boolean;
  /** Credenciais/config necessária presente (server-side). */
  configured: boolean;
  /** Resultado da última execução REAL conhecida. null = sem histórico. */
  lastRealRunOk: boolean | null;
  /** Já houve execução real com sucesso antes da última. */
  hadRealSuccessBefore: boolean;
  /** Execuções declaradamente simuladas (demos, dry-runs). */
  simulated: boolean;
  /** Erro conhecido que impede o funcionamento. */
  knownError: string | null;
}

/**
 * Evidência externa injetada pelo chamador (route handler / job service).
 * Tudo que o Hub ainda não persiste de verdade chega por aqui — nunca é
 * assumido como presente.
 */
export interface ToolHealthOverrides {
  configured?: boolean;
  lastRealRunOk?: boolean | null;
  hadRealSuccessBefore?: boolean;
  simulated?: boolean;
  knownError?: string | null;
}

export interface ToolHealth {
  toolId: string;
  /** false quando o id não existe no catálogo — estado nunca inventado. */
  found: boolean;
  state: ToolHealthState | null;
  /** Explicação legível e honesta do estado derivado. */
  reason: string;
  /** Estado legado declarado no catálogo (para auditoria da migração). */
  legacyState: string | null;
  /** Para onde o legado mapearia no novo modelo. */
  legacyMappedState: ToolHealthState | null;
  signals: ToolHealthSignals | null;
  /** Versão do contrato do adapter, quando registrado. */
  contractVersion: string | null;
  checkedAt: string;
}

/** Coleta os sinais observáveis de uma ferramenta. */
export function collectHealthSignals(
  tool: ToolEntry,
  overrides: ToolHealthOverrides = {},
): ToolHealthSignals {
  const adapter = toolRegistry.get(tool.id);
  return {
    adapterRegistered: adapter !== undefined,
    executionReady: adapter?.executionReady ?? false,
    configured: overrides.configured ?? false,
    lastRealRunOk: overrides.lastRealRunOk ?? null,
    hadRealSuccessBefore: overrides.hadRealSuccessBefore ?? false,
    simulated: overrides.simulated ?? false,
    knownError: overrides.knownError ?? null,
  };
}

/**
 * Deriva o estado de saúde a partir dos sinais, em ordem de prioridade.
 * Determinístico e testável; nenhuma transição "mágica".
 */
export function deriveStateFromSignals(
  signals: ToolHealthSignals,
): { state: ToolHealthState; reason: string } {
  // 1. Erro conhecido impeditivo → ERROR.
  if (signals.knownError) {
    return {
      state: "ERROR",
      reason: `Erro conhecido: ${signals.knownError}`,
    };
  }

  // 2. Última execução real falhou.
  if (signals.lastRealRunOk === false) {
    if (signals.hadRealSuccessBefore) {
      return {
        state: "DEGRADED",
        reason:
          "A ferramenta já executou com sucesso antes, mas a última execução real falhou. Requer investigação.",
      };
    }
    return {
      state: "ERROR",
      reason:
        "A última execução real falhou e não há registro de sucesso anterior.",
    };
  }

  // 3. READY — SOMENTE com executor real pronto + configurado + execução
  //    real comprovada. Adapter 501 (executionReady=false) nunca chega aqui.
  if (
    signals.executionReady &&
    signals.configured &&
    signals.lastRealRunOk === true
  ) {
    return {
      state: "READY",
      reason:
        "Executor real conectado, configurado e com execução funcional comprovada.",
    };
  }

  // 3b. Contradição honesta: houve sucesso real, mas o adapter atual não
  //     está pronto (ex.: esqueleto 501). Não é READY — exige revalidação.
  if (signals.lastRealRunOk === true && !signals.executionReady) {
    return {
      state: signals.configured ? "CONNECTED" : "NOT_CONFIGURED",
      reason:
        "Há registro de execução real com sucesso, mas o adapter atual não tem executor pronto (501) — revalidação pendente antes de qualquer uso.",
    };
  }

  // 4. Execução declaradamente simulada, sem sucesso real → SIMULATED.
  if (signals.simulated && signals.lastRealRunOk !== true) {
    return {
      state: "SIMULATED",
      reason:
        "Execuções declaradas como simuladas (demos/dry-runs). Nenhuma execução real aprovada.",
    };
  }

  // 5. Configurado (+ adapter registrado ou não) mas sem execução real
  //    aprovada → no máximo CONNECTED. CONNECTED ≠ READY.
  if (signals.configured) {
    return {
      state: "CONNECTED",
      reason: signals.adapterRegistered
        ? "Adapter registrado e configuração presente, mas sem execução real aprovada. Não autoriza uso produtivo."
        : "Configuração presente, mas sem adapter registrado e sem execução real aprovada. Não autoriza uso produtivo.",
    };
  }

  // 6. Padrão honesto: sem configuração evidenciada, sem execução.
  return {
    state: "NOT_CONFIGURED",
    reason: signals.adapterRegistered
      ? "Adapter registrado (contrato), mas sem configuração de executor/credenciais evidenciada e sem execução real."
      : "Sem adapter registrado e sem configuração evidenciada.",
  };
}

/**
 * Resolve o estado de saúde de uma ferramenta do catálogo.
 * Ponto único de verdade para UI, API e jobs.
 */
export function resolveToolState(
  tool: ToolEntry,
  overrides: ToolHealthOverrides = {},
): ToolHealth {
  const signals = collectHealthSignals(tool, overrides);
  const { state, reason } = deriveStateFromSignals(signals);
  const adapter = toolRegistry.get(tool.id);
  return {
    toolId: tool.id,
    found: true,
    state,
    reason,
    legacyState: tool.state,
    legacyMappedState: mapLegacyStateToHealth(tool.state),
    signals,
    contractVersion: adapter?.version ?? null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Saúde de uma ferramenta pelo id. Retorna `found: false` (nunca inventa)
 * quando o id não existe no catálogo.
 */
export function getToolHealth(
  id: string,
  overrides: ToolHealthOverrides = {},
): ToolHealth {
  const tool = getTool(id);
  if (!tool) {
    return {
      toolId: id,
      found: false,
      state: null,
      reason: `Ferramenta "${id}" não existe no catálogo.`,
      legacyState: null,
      legacyMappedState: null,
      signals: null,
      contractVersion: null,
      checkedAt: new Date().toISOString(),
    };
  }
  return resolveToolState(tool, overrides);
}
