/**
 * Athena Tools Hub — dead-letter queue do motor de execução (FASE 3).
 *
 * SEM TABELA NOVA NO SCHEMA: a DLQ é representada por jobs FAILED cujo
 * `error` contém `dead_lettered: true` + detalhe estruturado, mais um evento
 * append-only `dead_letter` na timeline. Nada se perde: o job, os params, o
 * histórico de tentativas e o motivo ficam consultáveis.
 *
 * Uma migration futura (0006, NÃO entregue aqui) poderá materializar a DLQ
 * numa tabela dedicada; ver docs/JOB_ENGINE.md.
 */

export const DEAD_LETTER_EVENT = "dead_letter";

export type DeadLetterCode =
  | "ATTEMPTS_EXHAUSTED"
  | "TIMEOUT"
  | "ORPHAN_UNRECOVERABLE";

export interface DeadLetterReason {
  code: DeadLetterCode;
  /** Mensagem legível do motivo. */
  message: string;
  attemptsUsed: number;
  maxAttempts: number;
  lastError?: string;
}

/** Payload de `error` gravado no job ao ir para a DLQ. */
export function buildDeadLetterError(reason: DeadLetterReason): Record<string, unknown> {
  return {
    code: "DEAD_LETTER",
    message: `Job movido para dead-letter: ${reason.message}`,
    dead_lettered: true,
    dead_letter: {
      reason_code: reason.code,
      attempts_used: reason.attemptsUsed,
      max_attempts: reason.maxAttempts,
      last_error: reason.lastError ?? null,
      at: new Date().toISOString(),
    },
  };
}

/** True quando o `error` do job marca dead-letter. */
export function isDeadLettered(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>).dead_lettered === true
  );
}

export interface DeadLetterDeps {
  appendEvent(
    jobId: string,
    orgId: string,
    type: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  failJob(
    jobId: string,
    orgId: string,
    error: Record<string, unknown>,
    note: string,
  ): Promise<void>;
}

/**
 * Envia o job para a dead-letter: evento `dead_letter` + FAILED com erro
 * estruturado. Chamar somente a partir de um estado que permite FAILED
 * (QUEUED/RUNNING) — a máquina de estados valida.
 */
export async function sendToDeadLetter(
  jobId: string,
  orgId: string,
  reason: DeadLetterReason,
  deps: DeadLetterDeps,
): Promise<void> {
  await deps.appendEvent(jobId, orgId, DEAD_LETTER_EVENT, `dead-letter (${reason.code})`, {
    reason_code: reason.code,
    attempts_used: reason.attemptsUsed,
    max_attempts: reason.maxAttempts,
  });
  await deps.failJob(
    jobId,
    orgId,
    buildDeadLetterError(reason),
    `dead-letter: ${reason.message}`,
  );
}

export interface DeadLetterRecord {
  jobId: string;
  orgId: string;
  toolId: string;
  reasonCode: string | null;
  attemptsUsed: number | null;
  deadAt: string | null;
}

export interface DeadLetterListDeps {
  listFailedWithError(
    orgId: string,
    limit: number,
  ): Promise<
    {
      id: string;
      orgId: string;
      toolId: string;
      error: unknown;
      createdAt: string;
    }[]
  >;
}

/** Lista os jobs na dead-letter (FAILED com `error.dead_lettered = true`). */
export async function listDeadLetters(
  orgId: string,
  deps: DeadLetterListDeps,
  limit = 50,
): Promise<DeadLetterRecord[]> {
  const failed = await deps.listFailedWithError(orgId, limit);
  return failed
    .filter((row) => isDeadLettered(row.error))
    .map((row) => {
      const detail = (row.error as Record<string, unknown> | null)?.dead_letter as
        | Record<string, unknown>
        | undefined;
      return {
        jobId: row.id,
        orgId: row.orgId,
        toolId: row.toolId,
        reasonCode: (detail?.reason_code as string | undefined) ?? null,
        attemptsUsed: (detail?.attempts_used as number | undefined) ?? null,
        deadAt: (detail?.at as string | undefined) ?? row.createdAt,
      };
    });
}
