/**
 * Athena Tools Hub — timeouts do motor de execução (FASE 3).
 *
 * Puro, sem I/O, exceto `withTimeout` (corrida de promises com AbortController).
 * O timeout por job é medido a partir de `started_at`; o worker também impõe
 * timeout por tentativa de execução via `withTimeout`.
 */

export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  readonly timeoutMs: number;
  readonly label: string;

  constructor(timeoutMs: number, label: string) {
    super(`Timeout após ${timeoutMs}ms (${label}).`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

/** Deadline absoluto (epoch ms) para um início + duração. */
export function deadlineFor(startedAtMs: number, timeoutMs: number): number {
  return startedAtMs + timeoutMs;
}

/** True quando `nowMs` já passou do deadline. */
export function isExpired(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs;
}

/** Ms restantes até o deadline (0 quando expirado). */
export function remainingMs(deadlineMs: number, nowMs: number): number {
  return Math.max(0, deadlineMs - nowMs);
}

export interface TimedOutJob {
  id: string;
  orgId: string;
  /** ISO de started_at (null = nunca iniciou de verdade; não é timeout). */
  startedAt: string | null;
}

/**
 * Filtra jobs RUNNING cujo `started_at + timeoutMs` já passou.
 * Usado pelo sweeper do worker e pela recuperação no arranque.
 * Jobs sem started_at são ignorados (claim incompleto — tratados como órfãos).
 */
export function findTimedOutJobs<T extends TimedOutJob>(
  jobs: readonly T[],
  timeoutMs: number,
  nowMs: number,
): T[] {
  return jobs.filter((job) => {
    if (!job.startedAt) return false;
    const started = Date.parse(job.startedAt);
    if (Number.isNaN(started)) return false;
    return isExpired(deadlineFor(started, timeoutMs), nowMs);
  });
}

/**
 * Executa `promise` com timeout. Se estourar, rejeita com TimeoutError e
 * aborta o `AbortSignal` entregue ao executor. Aceita um controller externo
 * para que o signal possa ser injetado no contexto de execução.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  controller: AbortController = new AbortController(),
): { promise: Promise<T>; signal: AbortSignal; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const wrapped = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(timeoutMs, label));
    }, timeoutMs);
    // Evita segurar o processo aberto só por causa do timer.
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    );
  });

  return {
    promise: wrapped,
    signal: controller.signal,
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
