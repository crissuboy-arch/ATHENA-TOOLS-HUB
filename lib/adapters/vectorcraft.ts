/**
 * Athena Tools Hub — adapter ESQUELETO do VectorCraft (contract-first).
 *
 * Estado honesto: em desenvolvimento. O contrato (validação de params e
 * dry-run) é real; a execução ainda não existe. `execute()` lança
 * NOT_IMPLEMENTED com mensagem clara — nenhuma execução é simulada.
 *
 * VectorCraft é a primeira candidata a execução real (decisão da Cristiane).
 * Quando o executor Rust/CLI/MCP estiver pronto, este arquivo ganha a
 * implementação real de `execute()` e `executionReady` passa a true.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Params aceitos pelo contrato inicial do VectorCraft. */
const vectorCraftParamsSchema = z
  .object({
    prompt: z.string().min(1, "prompt é obrigatório.").max(4000),
    width: z.number().int().min(16).max(4096).optional(),
    height: z.number().int().min(16).max(4096).optional(),
    style: z.string().max(120).optional(),
  })
  .passthrough();

export class VectorCraftAdapter implements ToolContract {
  readonly id = "vectorcraft";
  readonly version = "0.1.0-contract";
  readonly capabilities = ["vector.generate"];
  /** Executor real ainda não conectado — estado honesto. */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = vectorCraftParamsSchema.safeParse(params);
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
      // Geração de arte exige aprovação humana até o executor ser validado.
      requiresApproval: true,
      estimatedCost: "a definir (executor em desenvolvimento)",
    };
  }

  /**
   * Execução real — AINDA NÃO IMPLEMENTADA.
   * Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "executor em desenvolvimento — nenhuma execução simulada",
    );
  }
}

/** Registra o esqueleto no registry global. Importar este módulo = registrar. */
toolRegistry.register(new VectorCraftAdapter());
