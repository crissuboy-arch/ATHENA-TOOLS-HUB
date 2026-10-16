/**
 * Athena Tools Hub — adapter ESQUELETO do HyperFrames (contract-first).
 *
 * HyperFrames (heygen-com/hyperframes, Apache-2.0) é uma ferramenta de
 * PRODUÇÃO/RENDERIZAÇÃO de vídeo. Este adapter NÃO anuncia geração de
 * avatares de IA como capacidade nativa — essa nunca foi uma função do
 * HyperFrames.
 *
 * Estado honesto: catalogado. O contrato (validação de params e dry-run)
 * é real; a renderização real acontece num executor externo, fora do
 * frontend. `execute()` lança NOT_IMPLEMENTED — nenhuma execução é
 * simulada.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Params aceitos pelo contrato inicial do HyperFrames. */
const hyperFramesParamsSchema = z
  .object({
    model: z.string().min(1, "modelo de vídeo é obrigatório.").max(120),
    format: z.enum(["9:16", "1:1", "16:9"]),
    text: z.string().min(1, "texto/roteiro é obrigatório.").max(20000),
    assets: z.array(z.string().url()).max(20).optional(),
    durationSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .passthrough();

export class HyperFramesAdapter implements ToolContract {
  readonly id = "hyperframes";
  readonly version = "0.1.0-contract";
  readonly capabilities = ["video.render"];
  /** Nenhum executor de renderização conectado — estado honesto. */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = hyperFramesParamsSchema.safeParse(params);
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
      // Renderização externa pode gerar custo — sempre exige aprovação.
      requiresApproval: true,
      estimatedCost: "a definir (executor externo pendente)",
    };
  }

  /**
   * Renderização real — AINDA NÃO IMPLEMENTADA.
   * Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "executor de renderização externo pendente — nenhuma execução simulada",
    );
  }
}

/** Registra o esqueleto no registry global. Importar este módulo = registrar. */
toolRegistry.register(new HyperFramesAdapter());
