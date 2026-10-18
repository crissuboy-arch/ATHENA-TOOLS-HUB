/**
 * Athena Tools Hub — heartbeats e recuperação de jobs órfãos (FASE 3).
 *
 * SEM COLUNA NOVA NO SCHEMA: heartbeats são eventos append-only em
 * `execution_events` (type `heartbeat`, payload { worker_id, at }).
 * Um job RUNNING cujo último heartbeat é mais antigo que o limiar (ou que
 * nunca teve heartbeat) é considerado órfão — o worker que o segurava caiu.
 *
 * A recuperação acontece (a) no arranque do worker e (b) no sweeper
 * periódico. Toda recuperação gera evento auditado; nunca perde o job:
 * volta a QUEUED (RUNNING → QUEUED, transição FASE 3) ou vai a FAILED +
 * dead-letter quando o orçamento de retries esgotou.
 */

export interface HeartbeatConfig {
  /** Intervalo entre heartbeats do worker (ms). */
  heartbeatIntervalMs: number;
  /** Sem heartbeat por este tempo ⇒ órfão (ms). Deve ser >> heartbeatIntervalMs. */
  orphanThresholdMs: number;
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  heartbeatIntervalMs: 15_000,
  orphanThresholdMs: 60_000,
};

/** True quando já passou da hora de enviar outro heartbeat. */
export function shouldSendHeartbeat(
  lastSentAtMs: number | null,
  intervalMs: number,
  nowMs: number,
): boolean {
  if (lastSentAtMs === null) return true;
  return nowMs - lastSentAtMs >= intervalMs;
}

/**
 * True quando o job é órfão: sem heartbeat recente.
 * `lastHeartbeatAtMs = null` ⇒ nunca houve heartbeat ⇒ órfão somente se
 * o job já corre há mais que o limiar (evita matar claims recém-feitos).
 */
export function isOrphaned(
  lastHeartbeatAtMs: number | null,
  jobStartedAtMs: number | null,
  thresholdMs: number,
  nowMs: number,
): boolean {
  const ref = lastHeartbeatAtMs ?? jobStartedAtMs;
  if (ref === null) return true; // RUNNING sem started_at: claim incompleto
  return nowMs - ref >= thresholdMs;
}

/** Payload padrão do evento de heartbeat. */
export function heartbeatPayload(workerId: string, atIso: string): Record<string, unknown> {
  return { worker_id: workerId, at: atIso };
}

// ---------------------------------------------------------------------------
// Recuperação (orquestração com dependências injetadas — sem I/O direto)
// ---------------------------------------------------------------------------

export interface StaleJob {
  id: string;
  orgId: string;
  startedAt: string | null;
}

export interface RecoveryDeps {
  listRunning(orgId: string): Promise<StaleJob[]>;
  lastHeartbeatAt(jobId: string, orgId: string): Promise<string | null>;
  failedAttempts(jobId: string, orgId: string): Promise<number>;
  requeue(jobId: string, orgId: string, reason: string): Promise<void>;
  failAsTimeout(jobId: string, orgId: string): Promise<void>;
  failExhausted(jobId: string, orgId: string, attempts: number): Promise<void>;
  nowMs(): number;
}

export interface RecoveryReport {
  scanned: number;
  requeued: string[];
  failedTimeout: string[];
  failedExhausted: string[];
}

export interface RecoveryOptions {
  heartbeat: HeartbeatConfig;
  jobTimeoutMs: number;
  maxAttempts: number;
}

/**
 * Varre jobs RUNNING e recupera os problemáticos:
 *  1. timeout (started_at + jobTimeoutMs passou) → FAILED (motivo timeout);
 *  2. órfão com retries restantes → QUEUED (requeue, evento auditado);
 *  3. órfão sem retries restantes → FAILED + dead-letter.
 * Nunca perde jobs: todo RUNNING problemático termina num estado honesto
 * com evento registrado.
 */
export async function recoverStaleJobs(
  orgId: string,
  deps: RecoveryDeps,
  opts: RecoveryOptions,
): Promise<RecoveryReport> {
  const report: RecoveryReport = {
    scanned: 0,
    requeued: [],
    failedTimeout: [],
    failedExhausted: [],
  };
  const now = deps.nowMs();
  const running = await deps.listRunning(orgId);
  report.scanned = running.length;

  for (const job of running) {
    const startedMs = job.startedAt ? Date.parse(job.startedAt) : null;

    // 1) Timeout tem precedência: o job estourou o orçamento de tempo.
    if (startedMs !== null && !Number.isNaN(startedMs) && now - startedMs >= opts.jobTimeoutMs) {
      await deps.failAsTimeout(job.id, job.orgId);
      report.failedTimeout.push(job.id);
      continue;
    }

    // 2) Órfão?
    const hbIso = await deps.lastHeartbeatAt(job.id, job.orgId);
    const hbMs = hbIso ? Date.parse(hbIso) : null;
    if (!isOrphaned(hbMs, Number.isNaN(startedMs as number) ? null : startedMs, opts.heartbeat.orphanThresholdMs, now)) {
      continue; // saudável: heartbeat recente
    }

    // 3) Órfão: requeue se há orçamento, senão FAILED + dead-letter.
    const attempts = await deps.failedAttempts(job.id, job.orgId);
    if (attempts < opts.maxAttempts) {
      await deps.requeue(
        job.id,
        job.orgId,
        `worker sem heartbeat há mais de ${opts.heartbeat.orphanThresholdMs}ms — job recuperado para a fila`,
      );
      report.requeued.push(job.id);
    } else {
      await deps.failExhausted(job.id, job.orgId, attempts);
      report.failedExhausted.push(job.id);
    }
  }

  return report;
}
