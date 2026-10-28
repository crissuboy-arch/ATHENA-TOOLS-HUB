/**
 * Athena Tools Hub — JobStore em memória (harness isolado + testes).
 *
 * Implementa EXATAMENTE o contrato de lib/jobs/worker.ts (JobStore),
 * com as mesmas regras da máquina de estados (lib/jobs/machine.ts):
 * claim atómico QUEUED→RUNNING, transições validadas por canTransition,
 * e isolamento por org (um worker/org nunca vê nem toca jobs de outra
 * org — get/claim/event fora da org lançam, como o 404 do Supabase).
 *
 * Uso: harness de demonstração (scripts/demo-first-execution.ts) e
 * testes. NUNCA ligado à base viva — a base viva usa
 * createSupabaseJobStore.
 */

import { canTransition, type JobStatus } from "./machine";
import type { JobStore, QueuedJobRecord, RunningJobRecord } from "./worker";

export interface MemoryJobEvent {
  jobId: string;
  orgId: string;
  type: string;
  message: string | null;
  payload: Record<string, unknown>;
  at: string;
}

export interface MemoryJobSnapshot {
  id: string;
  orgId: string;
  toolId: string;
  status: JobStatus;
  startedAt: string | null;
  result: unknown;
  error: Record<string, unknown> | null;
  progress: number;
  events: MemoryJobEvent[];
}

interface MemoryJobRecord {
  id: string;
  orgId: string;
  toolId: string;
  params: Record<string, unknown>;
  missionId: string | null;
  status: JobStatus;
  startedAt: string | null;
  result: unknown;
  error: Record<string, unknown> | null;
  progress: number;
  seq: number;
  events: MemoryJobEvent[];
}

function extractMissionId(params: Record<string, unknown>): string | null {
  const value = params["mission_id"] ?? params["missionId"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, MemoryJobRecord>();
  private seq = 0;

  /** Semeia um job (harness/testes). Default: QUEUED. */
  seed(job: {
    id: string;
    orgId: string;
    toolId: string;
    params: Record<string, unknown>;
    status?: JobStatus;
  }): MemoryJobRecord {
    const record: MemoryJobRecord = {
      ...job,
      missionId: extractMissionId(job.params),
      status: job.status ?? "QUEUED",
      startedAt: null,
      result: null,
      error: null,
      progress: 0,
      seq: this.seq++,
      events: [],
    };
    this.jobs.set(record.id, record);
    return record;
  }

  /** Snapshot completo de um job (estado, resultado, eventos). */
  snapshot(jobId: string): MemoryJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`job não encontrado: ${jobId}`);
    return {
      id: job.id,
      orgId: job.orgId,
      toolId: job.toolId,
      status: job.status,
      startedAt: job.startedAt,
      result: job.result,
      error: job.error,
      progress: job.progress,
      events: [...job.events],
    };
  }

  private load(jobId: string, orgId: string): MemoryJobRecord {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) {
      throw new Error(`job não encontrado: ${jobId}`);
    }
    return job;
  }

  private transition(job: MemoryJobRecord, to: JobStatus): void {
    if (!canTransition(job.status, to)) {
      throw new Error(`transição inválida: ${job.status} → ${to} (job ${job.id})`);
    }
    job.status = to;
  }

  private pushEvent(
    job: MemoryJobRecord,
    type: string,
    message: string | null,
    payload: Record<string, unknown>,
  ): void {
    job.events.push({
      jobId: job.id,
      orgId: job.orgId,
      type,
      message,
      payload,
      at: new Date().toISOString(),
    });
  }

  async listQueued(orgId: string, limit: number): Promise<QueuedJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => j.orgId === orgId && j.status === "QUEUED")
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map((j) => ({
        id: j.id,
        orgId: j.orgId,
        toolId: j.toolId,
        params: j.params,
        missionId: j.missionId,
      }));
  }

  async claim(jobId: string, orgId: string, _workerId: string): Promise<boolean> {
    const job = this.load(jobId, orgId);
    if (job.status !== "QUEUED") return false; // outro worker venceu
    this.transition(job, "RUNNING");
    job.startedAt = new Date().toISOString();
    return true;
  }

  async get(jobId: string, orgId: string): Promise<RunningJobRecord> {
    const job = this.load(jobId, orgId);
    return {
      id: job.id,
      orgId: job.orgId,
      toolId: job.toolId,
      params: job.params,
      missionId: job.missionId,
      status: job.status,
      startedAt: job.startedAt,
    };
  }

  async heartbeat(jobId: string, orgId: string, workerId: string): Promise<void> {
    const job = this.load(jobId, orgId);
    this.pushEvent(job, "heartbeat", null, {
      worker_id: workerId,
      at: new Date().toISOString(),
    });
  }

  async event(
    jobId: string,
    orgId: string,
    type: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const job = this.load(jobId, orgId);
    this.pushEvent(job, type, message, payload);
  }

  async complete(jobId: string, orgId: string, result: unknown): Promise<void> {
    const job = this.load(jobId, orgId);
    this.transition(job, "COMPLETED");
    job.result = result;
    job.progress = 100;
  }

  async fail(
    jobId: string,
    orgId: string,
    error: Record<string, unknown>,
    _note?: string,
  ): Promise<void> {
    const job = this.load(jobId, orgId);
    this.transition(job, "FAILED");
    job.error = error;
  }

  async requeue(jobId: string, orgId: string, reason: string): Promise<void> {
    const job = this.load(jobId, orgId);
    this.transition(job, "QUEUED");
    job.startedAt = null;
    this.pushEvent(job, "requeued", reason, {});
  }

  async updateProgress(jobId: string, orgId: string, pct: number): Promise<void> {
    const job = this.load(jobId, orgId);
    job.progress = Math.max(0, Math.min(100, Math.round(pct)));
  }

  async listRunning(orgId: string): Promise<RunningJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => j.orgId === orgId && j.status === "RUNNING")
      .sort((a, b) => a.seq - b.seq)
      .map((j) => ({
        id: j.id,
        orgId: j.orgId,
        toolId: j.toolId,
        params: j.params,
        missionId: j.missionId,
        status: j.status,
        startedAt: j.startedAt,
      }));
  }

  async lastHeartbeatAt(jobId: string, orgId: string): Promise<string | null> {
    const job = this.load(jobId, orgId);
    const beats = job.events.filter((e) => e.type === "heartbeat");
    return beats.length > 0 ? beats[beats.length - 1]!.at : null;
  }

  async countEvents(jobId: string, orgId: string, type: string): Promise<number> {
    const job = this.load(jobId, orgId);
    return job.events.filter((e) => e.type === type).length;
  }
}
