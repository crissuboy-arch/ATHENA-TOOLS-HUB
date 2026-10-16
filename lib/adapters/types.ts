/**
 * Athena Tools Hub — ToolContract: o contrato que toda tool do catálogo implementa.
 *
 * Contract-first: a tool entra no catálogo com o contrato implementado e
 * `executionReady: false` até que um executor real esteja conectado.
 * NUNCA simular sucesso de execução — o status honesto é exposto via
 * `integrationStatus: 'pending'` nas respostas de jobs.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface DryRunInfo {
  /** Se true, o job exige aprovação humana (PENDING_APPROVAL) antes de executar. */
  requiresApproval: boolean;
  /** Estimativa legível de custo, ex. "~$0.10/s de vídeo". Opcional. */
  estimatedCost?: string;
}

export interface ToolContract {
  /** Identificador estável da tool (slug). Ex.: "vectorcraft". */
  id: string;
  /** Versão do contrato implementado. Ex.: "0.1.0-contract". */
  version: string;
  /** Capacidades declaradas. Ex.: ["vector.generate"]. */
  capabilities: string[];
  /**
   * True somente quando um executor REAL está conectado e validado.
   * Enquanto false, jobs ficam em estado honesto e GET retorna
   * integrationStatus: 'pending'.
   */
  executionReady: boolean;
  /** Valida os params do job contra o contrato (puro, sem I/O). */
  validateParams(params: unknown): ValidationResult;
  /** Informa se aprovação é necessária e custo estimado. */
  dryRunInfo(): DryRunInfo;
}

export class ToolAdapterRegistry {
  private adapters = new Map<string, ToolContract>();

  /** Registra (ou substitui) o adapter de uma tool. */
  register(adapter: ToolContract): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Retorna o adapter da tool, ou undefined se não registrado. */
  get(toolId: string): ToolContract | undefined {
    return this.adapters.get(toolId);
  }

  /** Alias de get() — ponto único de resolução tool → adapter. */
  adapterFor(toolId: string): ToolContract | undefined {
    return this.get(toolId);
  }

  /** Todas as tools registradas. */
  list(): ToolContract[] {
    return [...this.adapters.values()];
  }
}

/** Registro global — adapters se registram aqui no boot (ver lib/adapters/index). */
export const toolRegistry = new ToolAdapterRegistry();
