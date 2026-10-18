/**
 * Testes do worker (FASE 3) — JobStore, registry, clock e logger injetados.
 * Sem Supabase, sem rede. `npx vitest run lib/jobs/worker.test.ts`
 */
import { describe, expect, it } from "vitest";
import { ToolAdapterRegistry, type ToolContract } from "../adapters/types";
import { canTransition, type JobStatus } from "./machine";
import {
  createLogger,
  extractMissionId,
  Worker,
  type Clock,
  type ExecutionContext,
  type ExecutorFn,
  type JobStore,
  type QueuedJobRecord,
  type RunningJobRecord,
} from "./worker";
import { DEAD_LETTER_EVENT } from "./dead-letter";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeJob {
  id: string;
  orgId: string;
  toolId: string;
  status: JobStatus;
  params: Record<string, unknown>;
  startedAt: string | null;
  result: unknown;
  error: Record<string, unknown> | null;
  progress: number;
  seq: number;
}

interface FakeEvent {
  jobId: string;
  orgId: string;
  type: string;
  message: string | null;
  payload: Record<string, unknown>;
  at: string;
}

class FakeStore implements JobStore {
  jobs = new Map<string, FakeJob>();
  events: FakeEvent[] = [];
  private seq = 0;
  /** Claims que devem falhar (simula outro worker a vencer a corrida). */
  refuseClaim = new Set<string>();

  add(job: Omit<FakeJob, "seq" | "result" | "error" | "progress">): FakeJob {
    const full: FakeJob = { result: null, error: null, progress: 0, ...job, seq: this.seq++ };
    this.jobs.set(full.id, full);
    return full;
  }

  private transition(job: FakeJob, to: JobStatus): void {
    if (!canTransition(job.status, to)) {
      throw new Error(`transição inválida no fake: ${job.status} → ${to}`);
    }
    job.status = to;
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
        missionId: extractMissionId(j.params),
      }));
  }

  async claim(jobId: string, orgId: string, workerId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    if (this.refuseClaim.has(jobId)) return false;
    if (job.status !== "QUEUED") return false; // outro worker venceu
    this.transition(job, "RUNNING");
    job.startedAt = new Date().toISOString();
    this.events.push({
      jobId,
      orgId,
      type: "execution_started",
      message: `reclamado por ${workerId}`,
      payload: { worker_id: workerId },
      at: new Date().toISOString(),
    });
    return true;
  }

  async get(jobId: string, orgId: string): Promise<RunningJobRecord> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    return {
      id: job.id,
      orgId: job.orgId,
      toolId: job.toolId,
      params: job.params,
      missionId: extractMissionId(job.params),
      status: job.status,
      startedAt: job.startedAt,
    };
  }

  async heartbeat(jobId: string, orgId: string, workerId: string): Promise<void> {
    this.events.push({
      jobId,
      orgId,
      type: "heartbeat",
      message: null,
      payload: { worker_id: workerId, at: new Date().toISOString() },
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
    this.events.push({ jobId, orgId, type, message, payload, at: new Date().toISOString() });
  }

  async complete(jobId: string, orgId: string, result: unknown): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    this.transition(job, "COMPLETED");
    job.result = result;
    job.progress = 100;
  }

  async fail(jobId: string, orgId: string, error: Record<string, unknown>): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    this.transition(job, "FAILED");
    job.error = error;
  }

  async requeue(jobId: string, orgId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    this.transition(job, "QUEUED");
    job.startedAt = null;
  }

  async updateProgress(jobId: string, orgId: string, pct: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.orgId !== orgId) throw new Error("job não encontrado");
    job.progress = pct;
  }

  async listRunning(orgId: string): Promise<RunningJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => j.orgId === orgId && j.status === "RUNNING")
      .map((j) => ({
        id: j.id,
        orgId: j.orgId,
        toolId: j.toolId,
        params: j.params,
        missionId: extractMissionId(j.params),
        status: j.status,
        startedAt: j.startedAt,
      }));
  }

  async lastHeartbeatAt(jobId: string, orgId: string): Promise<string | null> {
    const hbs = this.events.filter(
      (e) => e.jobId === jobId && e.orgId === orgId && e.type === "heartbeat",
    );
    return hbs.length > 0 ? hbs[hbs.length - 1].at : null;
  }

  async countEvents(jobId: string, orgId: string, type: string): Promise<number> {
    return this.events.filter((e) => e.jobId === jobId && e.orgId === orgId && e.type === type)
      .length;
  }

  eventsOf(jobId: string, type: string): FakeEvent[] {
    return this.events.filter((e) => e.jobId === jobId && e.type === type);
  }
}

class FakeClock implements Clock {
  t: number;
  sleeps: number[] = [];
  constructor(start = 1_000_000) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
  }
}

class FakeAdapter implements ToolContract {
  readonly version = "test";
  readonly capabilities = ["test.run"];
  readonly executionReady: boolean;
  private readonly estimatedCost?: string;
  readonly execute: ExecutorFn;

  constructor(
    readonly id: string,
    opts: {
      executionReady: boolean;
      estimatedCost?: string;
      execute?: ExecutorFn;
    },
  ) {
    this.executionReady = opts.executionReady;
    this.estimatedCost = opts.estimatedCost;
    this.execute = opts.execute ?? (async () => ({ ok: true }));
  }

  validateParams(): { ok: boolean; errors: string[] } {
    return { ok: true, errors: [] };
  }

  dryRunInfo(): { requiresApproval: boolean; estimatedCost?: string } {
    return { requiresApproval: false, estimatedCost: this.estimatedCost };
  }
}

import type { WorkerConfig } from "./worker";

function setup(opts: {
  adapters?: FakeAdapter[];
  jobs?: Omit<FakeJob, "seq" | "result" | "error" | "progress">[];
  worker?: Partial<WorkerConfig>;
} = {}) {
  const store = new FakeStore();
  const clock = new FakeClock();
  const registry = new ToolAdapterRegistry();
  for (const a of opts.adapters ?? []) registry.register(a);
  for (const j of opts.jobs ?? []) store.add(j);
  const lines: string[] = [];
  const logger = createLogger("w-test", (l) => lines.push(l));
  const worker = new Worker({
    orgId: "org-1",
    workerId: "w-test",
    clock,
    logger,
    registry,
    store,
    random: () => 0.5, // jitter zero ⇒ delays determinísticos
    ...(opts.worker ?? {}),
  });
  return { store, clock, registry, lines, worker };
}

const queued = (
  id: string,
  toolId: string,
  params: Record<string, unknown> = {},
): Omit<FakeJob, "seq" | "result" | "error" | "progress"> => ({
  id,
  orgId: "org-1",
  toolId,
  status: "QUEUED",
  params,
  startedAt: null,
});

function logRecords(lines: string[]): Record<string, unknown>[] {
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("despacho honesto", () => {
  it("executa tool com executor pronto; tool sem adapter fica QUEUED (nada simulado)", async () => {
    const ready = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async (ctx: ExecutionContext) => ({ echo: ctx.params }),
    });
    const { store, worker, lines } = setup({
      adapters: [ready],
      jobs: [
        queued("j1", "tool-a", { mission_id: "m-123", x: 1 }),
        queued("j2", "tool-inexistente"),
      ],
    });

    await worker.tick();
    await worker.drain();

    expect(store.jobs.get("j1")!.status).toBe("COMPLETED");
    expect(store.jobs.get("j1")!.result).toEqual({ echo: { mission_id: "m-123", x: 1 } });
    // Honestidade: sem adapter ⇒ QUEUED, com evento dispatch_skipped, sem execução.
    expect(store.jobs.get("j2")!.status).toBe("QUEUED");
    expect(store.eventsOf("j2", "dispatch_skipped")).toHaveLength(1);
    expect(store.eventsOf("j2", "execution_started")).toHaveLength(0);

    // Logs estruturados com job_id + mission_id.
    const completed = logRecords(lines).find((r) => r.event === "execution_completed");
    expect(completed).toMatchObject({ jobId: "j1", missionId: "m-123", toolId: "tool-a" });
  });

  it("adapter com executionReady=false fica QUEUED (dispatch_skipped)", async () => {
    const skeleton = new FakeAdapter("tool-s", { executionReady: false });
    const { store, worker } = setup({
      adapters: [skeleton],
      jobs: [queued("j1", "tool-s")],
    });
    await worker.tick();
    await worker.drain();
    expect(store.jobs.get("j1")!.status).toBe("QUEUED");
    expect(store.eventsOf("j1", "dispatch_skipped")[0].payload).toMatchObject({
      reason: "executor_not_ready",
    });
    expect(store.eventsOf("j1", "execution_started")).toHaveLength(0);
  });

  it("claim perdido (outro worker venceu) não quebra o tick", async () => {
    const ready = new FakeAdapter("tool-a", { executionReady: true });
    const { store, worker } = setup({
      adapters: [ready],
      jobs: [queued("j1", "tool-a"), queued("j2", "tool-a")],
    });
    store.refuseClaim.add("j1"); // simula derrota na corrida atómica
    await worker.tick();
    await worker.drain();
    expect(store.jobs.get("j1")!.status).toBe("QUEUED");
    expect(store.jobs.get("j2")!.status).toBe("COMPLETED");
  });
});

describe("trava de custo", () => {
  const paid = () =>
    new FakeAdapter("tool-paga", {
      executionReady: true,
      estimatedCost: "~$0.10/s",
      execute: async () => ({ ok: true }),
    });

  it("BLOQUEIA execução com custo sem autorização explícita (fica QUEUED)", async () => {
    const { store, worker } = setup({
      adapters: [paid()],
      jobs: [queued("j1", "tool-paga")],
      worker: { allowPaidExecution: false },
    });
    await worker.tick();
    await worker.drain();
    expect(store.jobs.get("j1")!.status).toBe("QUEUED");
    expect(store.eventsOf("j1", "execution_blocked")[0].payload).toMatchObject({
      reason: "cost_gate",
    });
    expect(store.eventsOf("j1", "execution_started")).toHaveLength(0);
  });

  it("permite com allowPaidExecution=true explícito", async () => {
    const { store, worker } = setup({
      adapters: [paid()],
      jobs: [queued("j1", "tool-paga")],
      worker: { allowPaidExecution: true },
    });
    await worker.tick();
    await worker.drain();
    expect(store.jobs.get("j1")!.status).toBe("COMPLETED");
  });
});

describe("retries com backoff", () => {
  it("falha 2x e sucede na 3ª; delays 1000ms e 2000ms (exponencial)", async () => {
    let calls = 0;
    const flaky = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async () => {
        calls += 1;
        if (calls < 3) throw new Error(`boom ${calls}`);
        return "done";
      },
    });
    const { store, clock, worker } = setup({
      adapters: [flaky],
      jobs: [queued("j1", "tool-a")],
      worker: { retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000, multiplier: 2, jitterRatio: 0 } },
    });
    await worker.tick();
    await worker.drain();

    expect(store.jobs.get("j1")!.status).toBe("COMPLETED");
    expect(store.jobs.get("j1")!.result).toBe("done");
    expect(calls).toBe(3);
    expect(store.eventsOf("j1", "attempt_failed")).toHaveLength(2);
    expect(clock.sleeps).toEqual([1000, 2000]);
    expect(store.eventsOf("j1", "retry_scheduled")).toHaveLength(2);
  });

  it("esgota tentativas ⇒ FAILED + dead-letter (sem perda)", async () => {
    const always = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async () => {
        throw new Error("sempre falha");
      },
    });
    const { store, worker } = setup({
      adapters: [always],
      jobs: [queued("j1", "tool-a")],
      worker: { retry: { maxAttempts: 2, baseDelayMs: 10, jitterRatio: 0 } },
    });
    await worker.tick();
    await worker.drain();

    const job = store.jobs.get("j1")!;
    expect(job.status).toBe("FAILED");
    expect(job.error).toMatchObject({ code: "DEAD_LETTER", dead_lettered: true });
    expect(
      (job.error!.dead_letter as Record<string, unknown>).reason_code,
    ).toBe("ATTEMPTS_EXHAUSTED");
    expect(store.eventsOf("j1", DEAD_LETTER_EVENT)).toHaveLength(1);
    expect(store.eventsOf("j1", "attempt_failed")).toHaveLength(2);
  });

  it("timeout de tentativa ⇒ attempt_failed com motivo timeout", async () => {
    const hanging = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: () => new Promise<unknown>(() => {}), // nunca resolve
    });
    const { store, worker } = setup({
      adapters: [hanging],
      jobs: [queued("j1", "tool-a")],
      worker: { attemptTimeoutMs: 30, retry: { maxAttempts: 1, jitterRatio: 0 } },
    });
    await worker.tick();
    await worker.drain();

    const job = store.jobs.get("j1")!;
    expect(job.status).toBe("FAILED");
    const failed = store.eventsOf("j1", "attempt_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].payload).toMatchObject({ reason: "timeout" });
    expect(
      (job.error!.dead_letter as Record<string, unknown>).reason_code,
    ).toBe("TIMEOUT");
  });
});

describe("cancelamento", () => {
  it("job cancelado durante o backoff não tenta de novo", async () => {
    const failing = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async () => {
        throw new Error("boom");
      },
    });
    const { store, clock, worker } = setup({
      adapters: [failing],
      jobs: [queued("j1", "tool-a")],
      worker: { retry: { maxAttempts: 3, baseDelayMs: 5000, jitterRatio: 0 } },
    });
    // Cancela durante o primeiro sleep de backoff.
    const originalSleep = clock.sleep.bind(clock);
    let cancelled = false;
    clock.sleep = async (ms: number) => {
      if (!cancelled) {
        cancelled = true;
        store.jobs.get("j1")!.status = "CANCELLED"; // cancelamento externo (via API)
      }
      await originalSleep(ms);
    };

    await worker.tick();
    await worker.drain();

    expect(store.jobs.get("j1")!.status).toBe("CANCELLED");
    expect(store.eventsOf("j1", "attempt_failed")).toHaveLength(1);
    expect(store.eventsOf("j1", "attempt_started")).toHaveLength(1); // sem 2ª tentativa
    expect(store.eventsOf("j1", DEAD_LETTER_EVENT)).toHaveLength(0);
  });
});

describe("concorrência", () => {
  it("respeita o limite (concurrency=1 ⇒ nunca 2 em paralelo)", async () => {
    let parallel = 0;
    let maxParallel = 0;
    const slow = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async () => {
        parallel += 1;
        maxParallel = Math.max(maxParallel, parallel);
        await new Promise((r) => setTimeout(r, 20));
        parallel -= 1;
        return "ok";
      },
    });
    const { store, worker } = setup({
      adapters: [slow],
      jobs: [queued("j1", "tool-a"), queued("j2", "tool-a"), queued("j3", "tool-a")],
      worker: { concurrency: 1 },
    });
    for (let i = 0; i < 3; i++) {
      await worker.tick();
      await worker.drain();
    }
    expect(maxParallel).toBe(1);
    expect(store.jobs.get("j1")!.status).toBe("COMPLETED");
    expect(store.jobs.get("j2")!.status).toBe("COMPLETED");
    expect(store.jobs.get("j3")!.status).toBe("COMPLETED");
  });
});

describe("recuperação no arranque", () => {
  it("órfão com orçamento ⇒ QUEUED; timeout ⇒ FAILED; órfão esgotado ⇒ dead-letter", async () => {
    const { store, worker } = setup({
      adapters: [],
      worker: {
        heartbeat: { heartbeatIntervalMs: 15_000, orphanThresholdMs: 60_000 },
        jobTimeoutMs: 600_000,
        retry: { maxAttempts: 3 },
      },
    });
    const t0 = 1_000_000;
    // j-orphan: RUNNING há 200s, sem heartbeat, 1 tentativa falhada ⇒ requeue
    store.add({
      id: "j-orphan",
      orgId: "org-1",
      toolId: "tool-a",
      status: "RUNNING",
      params: {},
      startedAt: new Date(t0 - 200_000).toISOString(),
    });
    store.events.push({
      jobId: "j-orphan",
      orgId: "org-1",
      type: "attempt_failed",
      message: "x",
      payload: {},
      at: new Date(t0 - 190_000).toISOString(),
    });
    // j-timeout: RUNNING há 700s (> jobTimeoutMs) ⇒ FAILED/TIMEOUT
    store.add({
      id: "j-timeout",
      orgId: "org-1",
      toolId: "tool-a",
      status: "RUNNING",
      params: {},
      startedAt: new Date(t0 - 700_000).toISOString(),
    });
    // j-exhausted: órfão com 3 falhas ⇒ dead-letter
    store.add({
      id: "j-exhausted",
      orgId: "org-1",
      toolId: "tool-a",
      status: "RUNNING",
      params: {},
      startedAt: new Date(t0 - 200_000).toISOString(),
    });
    for (let i = 0; i < 3; i++) {
      store.events.push({
        jobId: "j-exhausted",
        orgId: "org-1",
        type: "attempt_failed",
        message: "x",
        payload: {},
        at: new Date(t0 - 190_000).toISOString(),
      });
    }
    // j-healthy: RUNNING com heartbeat recente ⇒ intocado
    store.add({
      id: "j-healthy",
      orgId: "org-1",
      toolId: "tool-a",
      status: "RUNNING",
      params: {},
      startedAt: new Date(t0 - 100_000).toISOString(),
    });
    store.events.push({
      jobId: "j-healthy",
      orgId: "org-1",
      type: "heartbeat",
      message: null,
      payload: {},
      at: new Date(t0 - 10_000).toISOString(),
    });

    const started = worker.start();
    worker.stop(); // a recuperação já correu antes do loop; o stop só sai do loop
    await started;

    expect(store.jobs.get("j-orphan")!.status).toBe("QUEUED");
    expect(store.jobs.get("j-timeout")!.status).toBe("FAILED");
    expect(store.jobs.get("j-timeout")!.error).toMatchObject({ code: "TIMEOUT" });
    expect(store.jobs.get("j-exhausted")!.status).toBe("FAILED");
    expect(store.jobs.get("j-exhausted")!.error).toMatchObject({
      code: "DEAD_LETTER",
      dead_lettered: true,
    });
    expect(store.jobs.get("j-healthy")!.status).toBe("RUNNING");
  });
});

describe("configuração", () => {
  it("rejeita configuração inválida (fail fast)", () => {
    expect(() => new Worker({ orgId: "o", concurrency: 0 })).toThrow();
    expect(
      () => new Worker({ orgId: "o", retry: { maxAttempts: 0 } }),
    ).toThrow(/RetryPolicy/);
    expect(
      () =>
        new Worker({
          orgId: "o",
          heartbeat: { heartbeatIntervalMs: 60_000, orphanThresholdMs: 10_000 },
        }),
    ).toThrow(/orphanThresholdMs/);
    expect(() => new Worker({ orgId: "" })).toThrow(/orgId/);
  });

  it("reportProgress atualiza o progresso do job", async () => {
    const seen: number[] = [];
    const reporting = new FakeAdapter("tool-a", {
      executionReady: true,
      execute: async (ctx: ExecutionContext) => {
        await ctx.reportProgress(42);
        return "ok";
      },
    });
    const { store, worker } = setup({
      adapters: [reporting],
      jobs: [queued("j1", "tool-a")],
    });
    const orig = store.updateProgress.bind(store);
    store.updateProgress = async (jobId: string, orgId: string, pct: number) => {
      seen.push(pct);
      await orig(jobId, orgId, pct);
    };
    await worker.tick();
    await worker.drain();
    expect(seen).toContain(42);
    expect(store.jobs.get("j1")!.status).toBe("COMPLETED");
  });
});
