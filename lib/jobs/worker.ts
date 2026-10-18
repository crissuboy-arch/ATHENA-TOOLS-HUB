/**
 * Athena Tools Hub — worker do motor de execução real (FASE 3).
 *
 * Responsabilidades:
 *  - despacho de jobs QUEUED com claiming ATÓMICO (só um worker vence);
 *  - controlo de concorrência (limite configurável);
 *  - retries com backoff (lib/jobs/retry.ts), timeout por tentativa/job
 *    (lib/jobs/timeout.ts), heartbeats e recuperação de órfãos
 *    (lib/jobs/heartbeat.ts), dead-letter (lib/jobs/dead-letter.ts);
 *  - TRAVA DE CUSTO: sem `allowPaidExecution: true`, nenhuma tool com custo
 *    estimado é executada — o job permanece QUEUED com evento `execution_blocked`;
 *  - HONESTIDADE: tool sem adapter, sem `executionReady` ou sem `execute()`
 *    implementado NUNCA é simulada — o job fica QUEUED com evento
 *    `dispatch_skipped` e o worker passa ao próximo.
 *
 * Todo o I/O de persistência passa pela interface `JobStore` (injetável;
 * `createSupabaseJobStore` é a implementação real sobre lib/jobs/service.ts),
 * o que permite testar o worker inteiro sem Supabase e sem rede.
 */

import { toolRegistry } from "../adapters/index";
import { ToolAdapterRegistry, type ToolContract } from "../adapters/types";
import type { JobStatus } from "./machine";
import {
  computeBackoffDelayMs,
  shouldRetry,
  validateRetryPolicy,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "./retry";
import { withTimeout, TimeoutError, findTimedOutJobs } from "./timeout";
import {
  recoverStaleJobs,
  shouldSendHeartbeat,
  heartbeatPayload,
  DEFAULT_HEARTBEAT_CONFIG,
  type HeartbeatConfig,
} from "./heartbeat";
import {
  sendToDeadLetter,
  type DeadLetterDeps,
  type DeadLetterReason,
} from "./dead-letter";
import * as jobService from "./service";

// ---------------------------------------------------------------------------
// Logging estruturado
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  worker: string;
  orgId?: string;
  jobId?: string;
  /** Rastreio ponta-a-ponta (vem de params.mission_id quando presente). */
  missionId?: string | null;
  toolId?: string;
  event: string;
  message?: string;
  data?: unknown;
}

export type Logger = (
  record: Omit<LogRecord, "ts" | "worker" | "level"> & { level?: LogLevel },
) => void;

/** Logger JSON de uma linha; `sink` injetável (testes capturam as linhas). */
export function createLogger(
  workerId: string,
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  return (record) => {
    const { level, ...rest } = record;
    const full: LogRecord = {
      ts: new Date().toISOString(),
      level: level ?? "info",
      worker: workerId,
      ...rest,
    };
    sink(JSON.stringify(full));
  };
}

/** Extrai o mission_id dos params para correlação (suporta snake e camel). */
export function extractMissionId(params: Record<string, unknown>): string | null {
  const value = params.mission_id ?? params.missionId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Contratos de execução
// ---------------------------------------------------------------------------

/** Contexto entregue ao `execute()` de um adapter real. */
export interface ExecutionContext {
  jobId: string;
  orgId: string;
  toolId: string;
  params: Record<string, unknown>;
  missionId: string | null;
  /** Tentativa atual (1-based). */
  attempt: number;
  maxAttempts: number;
  /** Abortado em timeout da tentativa ou no stop() do worker. */
  signal: AbortSignal;
  /** Reporta progresso 0..100 (gravado no job). */
  reportProgress(pct: number): Promise<void>;
}

/** Função de execução real de um adapter (`executionReady === true`). */
export type ExecutorFn = (ctx: ExecutionContext) => Promise<unknown>;

export interface QueuedJobRecord {
  id: string;
  orgId: string;
  toolId: string;
  params: Record<string, unknown>;
  missionId: string | null;
}

export interface RunningJobRecord extends QueuedJobRecord {
  status: JobStatus;
  startedAt: string | null;
}

/** Persistência abstraída — o worker nunca fala SQL/Supabase direto. */
export interface JobStore {
  listQueued(orgId: string, limit: number): Promise<QueuedJobRecord[]>;
  /** Claiming atómico QUEUED→RUNNING. false = outro worker venceu. */
  claim(jobId: string, orgId: string, workerId: string): Promise<boolean>;
  get(jobId: string, orgId: string): Promise<RunningJobRecord>;
  heartbeat(jobId: string, orgId: string, workerId: string): Promise<void>;
  event(
    jobId: string,
    orgId: string,
    type: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  complete(jobId: string, orgId: string, result: unknown): Promise<void>;
  fail(
    jobId: string,
    orgId: string,
    error: Record<string, unknown>,
    note?: string,
  ): Promise<void>;
  requeue(jobId: string, orgId: string, reason: string): Promise<void>;
  updateProgress(jobId: string, orgId: string, pct: number): Promise<void>;
  listRunning(orgId: string): Promise<RunningJobRecord[]>;
  lastHeartbeatAt(jobId: string, orgId: string): Promise<string | null>;
  countEvents(jobId: string, orgId: string, type: string): Promise<number>;
}

function toQueued(dto: jobService.JobDTO): QueuedJobRecord {
  return {
    id: dto.id,
    orgId: dto.orgId,
    toolId: dto.toolId,
    params: dto.params,
    missionId: extractMissionId(dto.params),
  };
}

function toRunning(dto: jobService.JobDTO): RunningJobRecord {
  return { ...toQueued(dto), status: dto.status, startedAt: dto.startedAt };
}

/** Implementação real do JobStore sobre lib/jobs/service.ts (Supabase). */
export function createSupabaseJobStore(workerId: string): JobStore {
  const actor = jobService.workerActor(workerId);
  return {
    listQueued: async (orgId, limit) =>
      (await jobService.listQueuedJobs(orgId, limit)).map(toQueued),
    claim: (jobId, orgId, wid) => jobService.claimJob(jobId, orgId, wid),
    get: async (jobId, orgId) => toRunning(await jobService.getJob(jobId, orgId)),
    heartbeat: async (jobId, orgId, wid) =>
      jobService.appendJobEvent(
        jobId,
        orgId,
        "heartbeat",
        null,
        heartbeatPayload(wid, new Date().toISOString()),
        actor,
      ),
    event: (jobId, orgId, type, message, payload) =>
      jobService.appendJobEvent(jobId, orgId, type, message, payload, actor),
    complete: (jobId, orgId, result) => jobService.completeJob(jobId, orgId, result, actor).then(() => undefined),
    fail: (jobId, orgId, error, note) =>
      jobService
        .applyTransition(jobId, orgId, "FAILED", actor, {
          note: note ?? String((error as { message?: unknown }).message ?? "falha na execução"),
          error,
          finishedAt: new Date().toISOString(),
        })
        .then(() => undefined),
    requeue: (jobId, orgId, reason) =>
      jobService.requeueJob(jobId, orgId, reason, actor).then(() => undefined),
    updateProgress: (jobId, orgId, pct) => jobService.updateJobProgress(jobId, orgId, pct),
    listRunning: async (orgId) => (await jobService.listRunningJobs(orgId)).map(toRunning),
    lastHeartbeatAt: (jobId, orgId) => jobService.lastHeartbeatAt(jobId, orgId),
    countEvents: (jobId, orgId, type) => jobService.countJobEvents(jobId, orgId, type),
  };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface WorkerConfig {
  orgId: string;
  workerId?: string;
  /** Jobs em execução simultânea. Default 2. */
  concurrency?: number;
  /** Intervalo entre varreduras da fila (ms). Default 2000. */
  pollIntervalMs?: number;
  retry?: Partial<RetryPolicy>;
  /** Timeout total do job a partir de started_at (ms). Default 600_000 (10 min). */
  jobTimeoutMs?: number;
  /** Timeout por tentativa de execução (ms). Default 300_000 (5 min). */
  attemptTimeoutMs?: number;
  heartbeat?: Partial<HeartbeatConfig>;
  /**
   * TRAVA DE CUSTO (default false): quando false, tools com custo estimado
   * (`dryRunInfo().estimatedCost`) NÃO são executadas — ficam QUEUED com
   * evento `execution_blocked`. Só `true` explícito autoriza gasto.
   */
  allowPaidExecution?: boolean;
  clock?: Clock;
  /** Aleatoriedade do jitter (injetável para testes determinísticos). */
  random?: () => number;
  logger?: Logger;
  registry?: ToolAdapterRegistry;
  store?: JobStore;
}

export class JobCancelledError extends Error {
  readonly code = "CANCELLED";
  constructor(jobId: string) {
    super(`Job ${jobId} foi cancelado durante a execução.`);
    this.name = "JobCancelledError";
  }
}

function randomId(): string {
  return `w-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class Worker {
  private readonly orgId: string;
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly jobTimeoutMs: number;
  private readonly attemptTimeoutMs: number;
  private readonly heartbeatCfg: HeartbeatConfig;
  private readonly allowPaidExecution: boolean;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly registry: ToolAdapterRegistry;
  private readonly store: JobStore;

  private running = false;
  private readonly active = new Map<string, Promise<void>>();
  private readonly lastHeartbeatSent = new Map<string, number>();
  /** Jobs já notificados com dispatch_skipped/execution_blocked (evita spam). */
  private readonly skipNotified = new Set<string>();

  constructor(config: WorkerConfig) {
    if (!config.orgId) throw new Error("WorkerConfig.orgId é obrigatório.");
    const concurrency = config.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("concurrency deve ser inteiro >= 1.");
    }
    const pollIntervalMs = config.pollIntervalMs ?? 2000;
    if (pollIntervalMs <= 0) throw new Error("pollIntervalMs deve ser > 0.");
    const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...config.retry };
    const retryErrors = validateRetryPolicy(retryPolicy);
    if (retryErrors.length > 0) {
      throw new Error(`RetryPolicy inválida: ${retryErrors.join(" ")}`);
    }
    const heartbeatCfg = { ...DEFAULT_HEARTBEAT_CONFIG, ...config.heartbeat };
    if (heartbeatCfg.orphanThresholdMs <= heartbeatCfg.heartbeatIntervalMs) {
      throw new Error("orphanThresholdMs deve ser maior que heartbeatIntervalMs.");
    }
    const jobTimeoutMs = config.jobTimeoutMs ?? 600_000;
    const attemptTimeoutMs = config.attemptTimeoutMs ?? 300_000;
    if (jobTimeoutMs <= 0 || attemptTimeoutMs <= 0) {
      throw new Error("jobTimeoutMs e attemptTimeoutMs devem ser > 0.");
    }

    this.orgId = config.orgId;
    this.workerId = config.workerId ?? randomId();
    this.concurrency = concurrency;
    this.pollIntervalMs = pollIntervalMs;
    this.retryPolicy = retryPolicy;
    this.jobTimeoutMs = jobTimeoutMs;
    this.attemptTimeoutMs = attemptTimeoutMs;
    this.heartbeatCfg = heartbeatCfg;
    this.allowPaidExecution = config.allowPaidExecution ?? false;
    this.clock = config.clock ?? systemClock;
    this.random = config.random ?? Math.random;
    this.log = config.logger ?? createLogger(this.workerId);
    this.registry = config.registry ?? toolRegistry;
    this.store = config.store ?? createSupabaseJobStore(this.workerId);
  }

  get id(): string {
    return this.workerId;
  }

  /** Jobs atualmente em execução neste worker. */
  get activeCount(): number {
    return this.active.size;
  }

  // -- ciclo de vida --------------------------------------------------------

  /**
   * Arranca o worker: recuperação de órfãos primeiro, depois o loop de
   * despacho até `stop()`. Resolve quando o loop termina (após `stop()`).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.log({ event: "worker_start", orgId: this.orgId, message: `worker ${this.workerId} arrancado` });

    const report = await this.recoverOnBoot();
    this.log({
      event: "recovery_completed",
      orgId: this.orgId,
      message: `recuperação: ${report.scanned} RUNNING varridos, ${report.requeued.length} requeued, ${report.failedTimeout.length} timeout, ${report.failedExhausted.length} dead-letter`,
      data: report,
    });

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.log({
          level: "error",
          event: "tick_error",
          orgId: this.orgId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (this.running) await this.clock.sleep(this.pollIntervalMs);
    }
    await this.drain();
    this.log({ event: "worker_stop", orgId: this.orgId, message: `worker ${this.workerId} parado` });
  }

  /** Pede paragem graciosa: o loop sai e `start()` aguarda os jobs ativos. */
  stop(): void {
    this.running = false;
  }

  /** Uma iteração: sweeper de timeout + preencher slots + heartbeats. */
  async tick(): Promise<void> {
    await this.sweepTimeouts();
    while (this.active.size < this.concurrency) {
      const claimed = await this.claimOne();
      if (!claimed) break;
      this.runInBackground(claimed.job, claimed.executor);
    }
    await this.heartbeatActive();
  }

  /** Aguarda os jobs ativos terminarem (usado no arranque/paragem e em testes). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.active.values()]);
  }

  // -- recuperação ----------------------------------------------------------

  private get deadLetterDeps(): DeadLetterDeps {
    const store = this.store;
    return {
      appendEvent: (jobId, orgId, type, message, payload) =>
        store.event(jobId, orgId, type, message, payload),
      failJob: (jobId, orgId, error, note) => store.fail(jobId, orgId, error, note),
    };
  }

  private recoverOnBoot(): Promise<{
    scanned: number;
    requeued: string[];
    failedTimeout: string[];
    failedExhausted: string[];
  }> {
    const store = this.store;
    const maxAttempts = this.retryPolicy.maxAttempts;
    const jobTimeoutMs = this.jobTimeoutMs;
    return recoverStaleJobs(
      this.orgId,
      {
        listRunning: async (orgId) =>
          (await store.listRunning(orgId)).map((r) => ({
            id: r.id,
            orgId: r.orgId,
            startedAt: r.startedAt,
          })),
        lastHeartbeatAt: (jobId, orgId) => store.lastHeartbeatAt(jobId, orgId),
        failedAttempts: (jobId, orgId) => store.countEvents(jobId, orgId, "attempt_failed"),
        requeue: (jobId, orgId, reason) => store.requeue(jobId, orgId, reason),
        failAsTimeout: (jobId, orgId) =>
          store.fail(
            jobId,
            orgId,
            {
              code: "TIMEOUT",
              message: `job excedeu o timeout de ${jobTimeoutMs}ms sem concluir`,
            },
            "timeout na recuperação do arranque",
          ),
        failExhausted: (jobId, orgId, attempts) =>
          sendToDeadLetter(
            jobId,
            orgId,
            {
              code: "ORPHAN_UNRECOVERABLE",
              message: "worker anterior caiu e o orçamento de tentativas esgotou",
              attemptsUsed: attempts,
              maxAttempts,
            },
            this.deadLetterDeps,
          ),
        nowMs: () => this.clock.now(),
      },
      {
        heartbeat: this.heartbeatCfg,
        jobTimeoutMs: this.jobTimeoutMs,
        maxAttempts: this.retryPolicy.maxAttempts,
      },
    );
  }

  // -- despacho -------------------------------------------------------------

  private async claimOne(): Promise<{ job: QueuedJobRecord; executor: ExecutorFn } | null> {
    const candidates = await this.store.listQueued(this.orgId, this.concurrency);
    for (const job of candidates) {
      const decision = this.dispatchDecision(job);
      if (!decision.executable) {
        // Notifica UMA vez por job (evita spam de eventos a cada tick).
        if (!this.skipNotified.has(job.id)) {
          this.skipNotified.add(job.id);
          await this.store.event(job.id, job.orgId, decision.eventType, decision.message, decision.payload);
          this.log({
            level: "warn",
            event: decision.eventType,
            orgId: job.orgId,
            jobId: job.id,
            missionId: job.missionId,
            toolId: job.toolId,
            message: decision.message,
          });
        }
        continue;
      }
      const claimed = await this.store.claim(job.id, job.orgId, this.workerId);
      if (!claimed) continue; // outro worker venceu a corrida — tenta o próximo
      this.log({
        event: "job_claimed",
        orgId: job.orgId,
        jobId: job.id,
        missionId: job.missionId,
        toolId: job.toolId,
        message: `job reclamado (QUEUED → RUNNING)`,
      });
      return { job, executor: decision.executor };
    }
    return null;
  }

  /**
   * Decisão honesta de despacho. Nunca autoriza execução simulada: sem
   * adapter, sem executionReady ou sem execute() ⇒ o job permanece QUEUED.
   */
  private dispatchDecision(job: QueuedJobRecord):
    | { executable: true; executor: ExecutorFn }
    | { executable: false; eventType: string; message: string; payload: Record<string, unknown> } {
    const adapter = this.registry.adapterFor(job.toolId);
    if (!adapter) {
      return {
        executable: false,
        eventType: "dispatch_skipped",
        message: `tool "${job.toolId}" sem adapter registrado — job permanece QUEUED (nada simulado)`,
        payload: { reason: "no_adapter", tool_id: job.toolId },
      };
    }
    if (!adapter.executionReady) {
      return {
        executable: false,
        eventType: "dispatch_skipped",
        message: `executor da tool "${job.toolId}" ainda não conectado (executionReady=false) — job permanece QUEUED`,
        payload: { reason: "executor_not_ready", tool_id: job.toolId },
      };
    }
    const executor = (adapter as unknown as { execute?: ExecutorFn }).execute;
    if (typeof executor !== "function") {
      return {
        executable: false,
        eventType: "dispatch_skipped",
        message: `adapter "${job.toolId}" marcado como pronto mas sem execute() implementado — job permanece QUEUED`,
        payload: { reason: "executor_not_implemented", tool_id: job.toolId },
      };
    }
    // TRAVA DE CUSTO: operação com custo estimado exige autorização explícita.
    const estimatedCost = safeEstimatedCost(adapter);
    if (estimatedCost && !this.allowPaidExecution) {
      return {
        executable: false,
        eventType: "execution_blocked",
        message: `trava de custo: "${job.toolId}" tem custo estimado (${estimatedCost}) e allowPaidExecution=false — job permanece QUEUED`,
        payload: { reason: "cost_gate", tool_id: job.toolId, estimated_cost: estimatedCost },
      };
    }
    return { executable: true, executor };
  }

  // -- execução -------------------------------------------------------------

  private runInBackground(job: QueuedJobRecord, executor: ExecutorFn): void {
    const promise = this.executeJob(job, executor)
      .catch((err) => {
        // Rede de segurança: executeJob já trata os erros esperados; aqui só
        // logamos para nunca deixar uma promise rejeitada sem registo.
        this.log({
          level: "error",
          event: "job_unhandled_error",
          orgId: job.orgId,
          jobId: job.id,
          missionId: job.missionId,
          toolId: job.toolId,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.active.delete(job.id);
        this.lastHeartbeatSent.delete(job.id);
      });
    this.active.set(job.id, promise);
  }

  private async executeJob(job: QueuedJobRecord, executor: ExecutorFn): Promise<void> {
    const { orgId } = job;
    const maxAttempts = this.retryPolicy.maxAttempts;
    let attempt = await this.store.countEvents(job.id, orgId, "attempt_failed");

    while (true) {
      const snap = await this.store.get(job.id, orgId);
      if (snap.status !== "RUNNING") {
        // Cancelado ou recuperado por outro processo — não tocar.
        this.log({
          level: "warn",
          event: "job_abandoned",
          orgId,
          jobId: job.id,
          missionId: job.missionId,
          toolId: job.toolId,
          message: `job saiu de RUNNING (estado atual: ${snap.status}) — execução abortada sem alterar o job`,
        });
        return;
      }

      attempt += 1;
      await this.store.event(job.id, orgId, "attempt_started", `tentativa ${attempt}/${maxAttempts}`, {
        attempt,
        max_attempts: maxAttempts,
      });
      this.log({
        event: "attempt_started",
        orgId,
        jobId: job.id,
        missionId: job.missionId,
        toolId: job.toolId,
        message: `tentativa ${attempt}/${maxAttempts}`,
      });

      try {
        const result = await this.runAttempt(job, executor, attempt, maxAttempts);
        const after = await this.store.get(job.id, orgId);
        if (after.status !== "RUNNING") {
          this.log({
            level: "warn",
            event: "job_abandoned",
            orgId,
            jobId: job.id,
            missionId: job.missionId,
            toolId: job.toolId,
            message: `job mudou para ${after.status} durante a execução — resultado descartado, sem simulação`,
          });
          return;
        }
        await this.store.complete(job.id, orgId, result);
        await this.store.event(job.id, orgId, "execution_completed", "execução concluída", {
          attempt,
        });
        this.log({
          event: "execution_completed",
          orgId,
          jobId: job.id,
          missionId: job.missionId,
          toolId: job.toolId,
          message: `concluído na tentativa ${attempt}`,
        });
        return;
      } catch (err) {
        if (err instanceof JobCancelledError) {
          this.log({
            level: "warn",
            event: "job_cancelled",
            orgId,
            jobId: job.id,
            missionId: job.missionId,
            toolId: job.toolId,
            message: err.message,
          });
          return;
        }
        const timedOut = err instanceof TimeoutError;
        const reason = timedOut ? "timeout" : "error";
        const message = err instanceof Error ? err.message : String(err);
        await this.store.event(job.id, orgId, "attempt_failed", `tentativa ${attempt} falhou (${reason})`, {
          attempt,
          reason,
          error: message,
        });
        this.log({
          level: "warn",
          event: "attempt_failed",
          orgId,
          jobId: job.id,
          missionId: job.missionId,
          toolId: job.toolId,
          message: `tentativa ${attempt} falhou (${reason}): ${message}`,
        });

        const after = await this.store.get(job.id, orgId);
        if (after.status !== "RUNNING") return; // cancelado/reaped durante a tentativa

        if (!shouldRetry(attempt, this.retryPolicy)) {
          const dlReason: DeadLetterReason = {
            code: timedOut ? "TIMEOUT" : "ATTEMPTS_EXHAUSTED",
            message: timedOut
              ? `timeout em todas as ${attempt} tentativas`
              : `falha após ${attempt} tentativa(s)`,
            attemptsUsed: attempt,
            maxAttempts,
            lastError: message,
          };
          await sendToDeadLetter(job.id, orgId, dlReason, this.deadLetterDeps);
          this.log({
            level: "error",
            event: "dead_letter",
            orgId,
            jobId: job.id,
            missionId: job.missionId,
            toolId: job.toolId,
            message: `job movido para dead-letter: ${dlReason.message}`,
          });
          return;
        }

        const delay = computeBackoffDelayMs(attempt, this.retryPolicy, this.random);
        await this.store.event(job.id, orgId, "retry_scheduled", `nova tentativa em ${delay}ms`, {
          next_attempt: attempt + 1,
          delay_ms: delay,
        });
        this.log({
          event: "retry_scheduled",
          orgId,
          jobId: job.id,
          missionId: job.missionId,
          toolId: job.toolId,
          message: `nova tentativa (${attempt + 1}/${maxAttempts}) em ${delay}ms`,
        });
        await this.sleepWithHeartbeat(job, delay); // lança JobCancelledError se cancelado
      }
    }
  }

  private async runAttempt(
    job: QueuedJobRecord,
    executor: ExecutorFn,
    attempt: number,
    maxAttempts: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const ctx: ExecutionContext = {
      jobId: job.id,
      orgId: job.orgId,
      toolId: job.toolId,
      params: job.params,
      missionId: job.missionId,
      attempt,
      maxAttempts,
      signal: controller.signal,
      reportProgress: (pct) => this.store.updateProgress(job.id, job.orgId, pct),
    };
    const { promise, cancel } = withTimeout(
      executor(ctx),
      this.attemptTimeoutMs,
      `job ${job.id} tentativa ${attempt}`,
      controller,
    );
    try {
      return await promise;
    } finally {
      cancel();
    }
  }

  /**
   * Sleep entre retries com heartbeat periódico e deteção de cancelamento.
   * Lança JobCancelledError se o job sair de RUNNING durante a espera.
   */
  private async sleepWithHeartbeat(job: QueuedJobRecord, totalMs: number): Promise<void> {
    const chunk = Math.min(this.heartbeatCfg.heartbeatIntervalMs, totalMs);
    let remaining = totalMs;
    while (remaining > 0) {
      const wait = Math.min(chunk, remaining);
      await this.clock.sleep(wait);
      remaining -= wait;
      const snap = await this.store.get(job.id, job.orgId);
      if (snap.status !== "RUNNING") throw new JobCancelledError(job.id);
      await this.store.heartbeat(job.id, job.orgId, this.workerId);
      this.lastHeartbeatSent.set(job.id, this.clock.now());
    }
  }

  // -- heartbeats e sweepers -------------------------------------------------

  private async heartbeatActive(): Promise<void> {
    const now = this.clock.now();
    for (const jobId of this.active.keys()) {
      const last = this.lastHeartbeatSent.get(jobId) ?? null;
      if (!shouldSendHeartbeat(last, this.heartbeatCfg.heartbeatIntervalMs, now)) continue;
      // Recupera orgId/jobId a partir do primeiro snapshot conhecido.
      const job = await this.findActiveJob(jobId);
      if (!job) continue;
      await this.store.heartbeat(job.id, job.orgId, this.workerId);
      this.lastHeartbeatSent.set(jobId, now);
    }
  }

  /** Jobs RUNNING sem heartbeat/timeout: este worker não os detém → dead-letter. */
  private async sweepTimeouts(): Promise<void> {
    const running = await this.store.listRunning(this.orgId);
    const expired = findTimedOutJobs(running, this.jobTimeoutMs, this.clock.now());
    for (const job of expired) {
      if (this.active.has(job.id)) continue; // governado pelo timeout de tentativa
      this.log({
        level: "warn",
        event: "job_timeout_sweep",
        orgId: job.orgId,
        jobId: job.id,
        missionId: job.missionId,
        toolId: job.toolId,
        message: `job RUNNING há mais de ${this.jobTimeoutMs}ms sem concluir — dead-letter`,
      });
      const attemptsUsed = await this.store.countEvents(job.id, job.orgId, "attempt_failed");
      await sendToDeadLetter(
        job.id,
        job.orgId,
        {
          code: "TIMEOUT",
          message: `sem conclusão após ${this.jobTimeoutMs}ms em RUNNING`,
          attemptsUsed,
          maxAttempts: this.retryPolicy.maxAttempts,
        },
        this.deadLetterDeps,
      );
    }
  }

  private async findActiveJob(jobId: string): Promise<RunningJobRecord | null> {
    try {
      return await this.store.get(jobId, this.orgId);
    } catch {
      return null;
    }
  }
}

/** Custo estimado de forma segura (adapters nunca devem quebrar o despacho). */
function safeEstimatedCost(adapter: ToolContract): string | null {
  try {
    const cost = adapter.dryRunInfo().estimatedCost;
    return typeof cost === "string" && cost.length > 0 ? cost : null;
  } catch {
    return null;
  }
}
