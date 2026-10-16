/**
 * Athena Tools Hub — adapter ESQUELETO do Apify MCP (contract-first).
 *
 * Regras inegociáveis da proprietária (aplicadas no contrato):
 * - A integração Apify existente via ScalaFlow NÃO é tocada por este Hub.
 * - Nenhuma conta nova é contratada aqui; nenhuma execução sem teto de gasto.
 * - Tokens nunca aparecem no navegador — só no servidor/vault.
 *
 * Estado honesto: needs-config. O contrato (validação de params e dry-run)
 * é real; a execução via MCP isolado ainda não existe. `execute()` lança
 * NOT_IMPLEMENTED — nenhuma execução é simulada.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Params aceitos pelo contrato inicial do Apify MCP. */
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

export class ApifyMcpAdapter implements ToolContract {
  readonly id = "apify-mcp";
  readonly version = "0.1.0-contract";
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

  /**
   * Execução real — AINDA NÃO IMPLEMENTADA.
   * Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "conexão Apify MCP dedicada pendente — nenhuma execução simulada; " +
        "a integração via ScalaFlow não é tocada",
    );
  }
}

/** Registra o esqueleto no registry global. Importar este módulo = registrar. */
toolRegistry.register(new ApifyMcpAdapter());
