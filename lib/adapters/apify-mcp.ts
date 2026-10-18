/**
 * Athena Tools Hub — adapter Apify MCP (contract-first + guardrails).
 *
 * Regras inegociáveis da proprietária (aplicadas no contrato):
 * - A integração Apify existente via ScalaFlow NÃO é tocada por este Hub.
 * - Usa-se a assinatura EXISTENTE da Cristiane — NUNCA se cria segunda
 *   assinatura aqui.
 * - Nenhuma conta nova é contratada; nenhuma execução sem teto de gasto.
 * - Tokens nunca aparecem no navegador — só no servidor/vault.
 *
 * APIs OFICIAIS Apify (docs.apify.com — nada inventado):
 * - Iniciar run:  POST https://api.apify.com/v2/acts/{author~actor}/runs
 * - Estado:       GET  https://api.apify.com/v2/actor-runs/{runId}
 * - Resultados:   GET  https://api.apify.com/v2/datasets/{datasetId}/items
 * - Síncrono curto: POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items
 * - MCP hospedado: https://mcp.apify.com?tools=<lista>
 * Autenticação: token da conta via env APIFY_TOKEN (nunca hardcoded,
 * nunca no cliente).
 *
 * Este módulo implementa os GUARDRAILS como funções puras (sem I/O):
 * limites de consumo configuráveis, registo de execuções e de custos.
 * `execute()` lança 501 até o worker MCP isolado estar ligado — nenhuma
 * execução simulada. Sem token → estado NOT_CONFIGURED honesto.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Base oficial da API Apify v2. */
export const APIFY_API_BASE = "https://api.apify.com/v2";

/** Params aceitos pelo contrato do Apify MCP. */
const apifyMcpParamsSchema = z
  .object({
    actor: z
      .string()
      .min(1, "Actor permitido é obrigatório.")
      .max(200),
    params: z.record(z.string(), z.unknown()).default({}),
    // Teto de gasto obrigatório — sem ele, a execução nem é validada.
    maxCostCents: z
      .number()
      .int()
      .min(1, "teto de gasto (maxCostCents) é obrigatório e deve ser ≥ 1."),
  })
  .passthrough();

export type ApifyMcpParams = z.infer<typeof apifyMcpParamsSchema>;

/** Configuração — lida SÓ de ambiente do servidor. Sem defaults inventados. */
export interface ApifyConfig {
  configured: boolean;
  /** true quando APIFY_TOKEN existe (o valor NUNCA é exposto). */
  tokenPresent: boolean;
  /** Allowlist de actors (CSV em APIFY_ACTOR_ALLOWLIST); vazio = sem filtro. */
  actorAllowlist: string[];
  /** Teto mensal em cêntimos (APIFY_MONTHLY_CAP_CENTS). 0 = sem teto global. */
  monthlyCapCents: number;
  /** Teto por job em cêntimos (APIFY_PER_JOB_CAP_CENTS). 0 = sem teto global. */
  perJobCapCents: number;
  reason?: string;
}

function parseCents(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolveApifyConfig(
  env: Record<string, string | undefined> = process.env,
): ApifyConfig {
  const tokenPresent = Boolean((env["APIFY_TOKEN"] ?? "").trim());
  const actorAllowlist = (env["APIFY_ACTOR_ALLOWLIST"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const monthlyCapCents = parseCents(env["APIFY_MONTHLY_CAP_CENTS"]);
  const perJobCapCents = parseCents(env["APIFY_PER_JOB_CAP_CENTS"]);
  if (!tokenPresent) {
    return {
      configured: false,
      tokenPresent: false,
      actorAllowlist,
      monthlyCapCents,
      perJobCapCents,
      reason:
        "APIFY_TOKEN não definido — usar o token da assinatura existente " +
        "(via ScalaFlow); ver docs/VIDEO_CONNECTORS.md",
    };
  }
  return {
    configured: true,
    tokenPresent: true,
    actorAllowlist,
    monthlyCapCents,
    perJobCapCents,
  };
}

/** Limites de consumo configuráveis para execuções Apify. */
export interface ApifyBudget {
  /** Teto mensal em cêntimos (0 = sem teto). */
  monthlyCapCents: number;
  /** Teto por job em cêntimos (0 = sem teto). */
  perJobCapCents: number;
  /** Actors permitidos (formato `autor/actor`); vazio = sem filtro. */
  actorAllowlist: string[];
}

export function budgetFromConfig(config: ApifyConfig): ApifyBudget {
  return {
    monthlyCapCents: config.monthlyCapCents,
    perJobCapCents: config.perJobCapCents,
    actorAllowlist: config.actorAllowlist,
  };
}

/** Registo de uma execução Apify (custos reais, nunca estimativas inventadas). */
export interface ApifyRunRecord {
  runId: string;
  actor: string;
  status: "started" | "succeeded" | "failed" | "aborted";
  startedAt: string;
  finishedAt?: string;
  /** Teto aprovado para este job (do params). */
  maxCostCents: number;
  /**
   * Custo real em cêntimos, preenchido ao fim do run a partir da API.
   * null = ainda desconhecido (nunca inventar).
   */
  usageCents: number | null;
}

export type ApifyLedger = ApifyRunRecord[];

/** "YYYY-MM" de um ISO date — para o teto mensal. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Soma do custo REAL registado no mês (só usageCents conhecidos). */
export function monthSpendCents(ledger: ApifyLedger, yearMonth: string): number {
  return ledger
    .filter((r) => monthKey(r.startedAt) === yearMonth)
    .reduce((sum, r) => sum + (r.usageCents ?? 0), 0);
}

/**
 * Verifica se um novo job cabe no orçamento. Função pura.
 * `nowIso` permite testes determinísticos.
 */
export function checkBudget(
  budget: ApifyBudget,
  ledger: ApifyLedger,
  proposedMaxCostCents: number,
  nowIso: string = new Date().toISOString(),
): { allowed: boolean; reason?: string } {
  if (budget.perJobCapCents > 0 && proposedMaxCostCents > budget.perJobCapCents) {
    return {
      allowed: false,
      reason:
        `teto por job excedido: pedido ${proposedMaxCostCents}¢ > ` +
        `limite ${budget.perJobCapCents}¢`,
    };
  }
  if (budget.monthlyCapCents > 0) {
    const spent = monthSpendCents(ledger, monthKey(nowIso));
    if (spent + proposedMaxCostCents > budget.monthlyCapCents) {
      return {
        allowed: false,
        reason:
          `teto mensal excedido: gasto ${spent}¢ + pedido ` +
          `${proposedMaxCostCents}¢ > limite ${budget.monthlyCapCents}¢`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Gate completo antes de qualquer execução: config + allowlist + orçamento.
 * Função pura — o futuro executor chama isto antes de tocar na API.
 * Lança HubError (VALIDATION 400 / NOT_IMPLEMENTED 501) quando bloqueado.
 */
export function assertExecutionAllowed(
  params: ApifyMcpParams,
  config: ApifyConfig,
  ledger: ApifyLedger,
  nowIso: string = new Date().toISOString(),
): { ok: true } {
  if (!config.configured) {
    throw HubError.notImplemented(
      `Apify não configurado: ${config.reason ?? "sem token"}`,
    );
  }
  const budget = budgetFromConfig(config);
  if (
    budget.actorAllowlist.length > 0 &&
    !budget.actorAllowlist.includes(params.actor)
  ) {
    throw HubError.validation(
      `actor '${params.actor}' fora da allowlist configurada.`,
    );
  }
  const check = checkBudget(budget, ledger, params.maxCostCents, nowIso);
  if (!check.allowed) {
    throw HubError.validation(`orçamento bloqueado: ${check.reason}`);
  }
  return { ok: true };
}

/** Regista o início de um run (imutável — devolve novo ledger). */
export function recordRunStart(
  ledger: ApifyLedger,
  entry: Omit<ApifyRunRecord, "status" | "usageCents">,
): ApifyLedger {
  return [
    ...ledger,
    { ...entry, status: "started" as const, usageCents: null },
  ];
}

/** Regista o fim de um run com o custo REAL (imutável). */
export function recordRunFinish(
  ledger: ApifyLedger,
  runId: string,
  patch: {
    status: "succeeded" | "failed" | "aborted";
    finishedAt: string;
    usageCents: number | null;
  },
): ApifyLedger {
  return ledger.map((r) =>
    r.runId === runId ? { ...r, ...patch } : r,
  );
}

/**
 * Endpoints oficiais usados pelo futuro worker (construção pura de URLs —
 * o token vai no header Authorization, nunca na URL em logs).
 */
export function apifyRunUrl(actor: string): string {
  const apiActor = actor.replace("/", "~");
  return `${APIFY_API_BASE}/acts/${apiActor}/runs`;
}
export function apifyRunStatusUrl(runId: string): string {
  return `${APIFY_API_BASE}/actor-runs/${runId}`;
}
export function apifyDatasetItemsUrl(datasetId: string): string {
  return `${APIFY_API_BASE}/datasets/${datasetId}/items`;
}

export class ApifyMcpAdapter implements ToolContract {
  readonly id = "apify-mcp";
  readonly version = "0.2.0-contract";
  readonly capabilities = ["research.run"];
  /** Conexão MCP dedicada ainda não configurada — estado honesto. */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = apifyMcpParamsSchema.safeParse(params);
    if (result.success) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "params"}: ${i.message}`,
      ),
    };
  }

  dryRunInfo(): DryRunInfo {
    return {
      // Consumo pago: sempre exige aprovação humana + teto de gasto.
      requiresApproval: true,
      estimatedCost: "conforme teto maxCostCents informado",
    };
  }

  /** Estado honesto da configuração (sem expor o token). */
  configStatus(env: Record<string, string | undefined> = process.env): {
    status: "configured" | "not_configured";
    reason?: string;
  } {
    const cfg = resolveApifyConfig(env);
    return cfg.configured
      ? { status: "configured" }
      : { status: "not_configured", reason: cfg.reason };
  }

  /**
   * Execução real — AINDA NÃO IMPLEMENTADA.
   * Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    const cfg = resolveApifyConfig();
    if (!cfg.configured) {
      throw HubError.notImplemented(
        `Apify NOT_CONFIGURED: ${cfg.reason} — nenhuma execução simulada`,
      );
    }
    throw HubError.notImplemented(
      "conexão Apify MCP dedicada pendente — nenhuma execução simulada; " +
        "a integração via ScalaFlow não é tocada",
    );
  }
}

/** Registra o adapter no registry global. Importar este módulo = registrar. */
toolRegistry.register(new ApifyMcpAdapter());
