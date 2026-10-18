/**
 * Athena Tools Hub — política de retries do motor de execução (FASE 3).
 *
 * Puro, sem I/O: backoff exponencial com jitter, testável por unidade.
 * O worker (lib/jobs/worker.ts) executa o sleep entre tentativas com o job
 * em RUNNING; o orçamento de tentativas é auditado via execution_events
 * (tipos `attempt_started` / `attempt_failed`).
 */

export interface RetryPolicy {
  /** Número MÁXIMO de tentativas de execução (inclui a primeira). */
  maxAttempts: number;
  /** Delay base do backoff (ms). */
  baseDelayMs: number;
  /** Teto do delay (ms). */
  maxDelayMs: number;
  /** Multiplicador exponencial por tentativa. */
  multiplier: number;
  /** Fração de jitter aplicada ao delay (0..1). Ex.: 0.25 = ±25%. */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  multiplier: 2,
  jitterRatio: 0.25,
};

/**
 * Delay antes da PRÓXIMA tentativa.
 * `attempt` = número da tentativa que acabou de falhar (1-based).
 * Ex.: falha da tentativa 1 → delay antes da tentativa 2.
 *
 * delay = min(base * multiplier^(attempt-1), max) ± jitter
 * `random` é injetável para testes determinísticos (default: Math.random).
 */
export function computeBackoffDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  if (attempt < 1) return 0;
  const grown = policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 1);
  const capped = Math.min(grown, policy.maxDelayMs);
  const jitter = capped * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * True quando ainda há orçamento para mais uma tentativa.
 * `attemptsUsed` = tentativas já consumidas (falhadas).
 */
export function shouldRetry(
  attemptsUsed: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  return attemptsUsed < policy.maxAttempts;
}

/** Tentativas restantes (0 quando o orçamento esgotou). */
export function attemptsRemaining(
  attemptsUsed: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  return Math.max(0, policy.maxAttempts - attemptsUsed);
}

/** Valida uma política vinda de configuração (falha rápido em valores absurdos). */
export function validateRetryPolicy(policy: RetryPolicy): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    errors.push("maxAttempts deve ser inteiro >= 1.");
  }
  if (policy.baseDelayMs < 0) errors.push("baseDelayMs deve ser >= 0.");
  if (policy.maxDelayMs < policy.baseDelayMs) {
    errors.push("maxDelayMs deve ser >= baseDelayMs.");
  }
  if (policy.multiplier < 1) errors.push("multiplier deve ser >= 1.");
  if (policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    errors.push("jitterRatio deve estar entre 0 e 1.");
  }
  return errors;
}
