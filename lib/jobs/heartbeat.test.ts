/**
 * Testes de heartbeat e recuperação de órfãos (sem I/O real; deps injetadas).
 * `npx vitest run lib/jobs/heartbeat.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_CONFIG,
  heartbeatPayload,
  isOrphaned,
  recoverStaleJobs,
  shouldSendHeartbeat,
  type RecoveryDeps,
} from "./heartbeat";

describe("shouldSendHeartbeat", () => {
  it("envia quando nunca enviou ou o intervalo passou", () => {
    expect(shouldSendHeartbeat(null, 15_000, 100_000)).toBe(true);
    expect(shouldSendHeartbeat(80_000, 15_000, 100_000)).toBe(true);
    expect(shouldSendHeartbeat(90_000, 15_000, 100_000)).toBe(false);
  });
});

describe("isOrphaned", () => {
  const threshold = 60_000;
  const now = 1_000_000;

  it("heartbeat recente ⇒ não é órfão", () => {
    expect(isOrphaned(now - 10_000, now - 120_000, threshold, now)).toBe(false);
  });

  it("heartbeat antigo ⇒ órfão", () => {
    expect(isOrphaned(now - 61_000, now - 120_000, threshold, now)).toBe(true);
  });

  it("sem heartbeat: usa started_at; claim recém-feito não é órfão", () => {
    expect(isOrphaned(null, now - 10_000, threshold, now)).toBe(false);
    expect(isOrphaned(null, now - 61_000, threshold, now)).toBe(true);
  });

  it("sem heartbeat nem started_at ⇒ órfão (claim incompleto)", () => {
    expect(isOrphaned(null, null, threshold, now)).toBe(true);
  });
});

describe("heartbeatPayload", () => {
  it("inclui worker_id e timestamp", () => {
    expect(heartbeatPayload("w-1", "2026-10-18T00:00:00.000Z")).toEqual({
      worker_id: "w-1",
      at: "2026-10-18T00:00:00.000Z",
    });
  });
});

function makeDeps(overrides: Partial<RecoveryDeps> = {}): RecoveryDeps & {
  calls: { requeue: string[]; failAsTimeout: string[]; failExhausted: string[] };
} {
  const calls = { requeue: [] as string[], failAsTimeout: [] as string[], failExhausted: [] as string[] };
  return {
    calls,
    listRunning: async () => [],
    lastHeartbeatAt: async () => null,
    failedAttempts: async () => 0,
    requeue: async (jobId) => {
      calls.requeue.push(jobId);
    },
    failAsTimeout: async (jobId) => {
      calls.failAsTimeout.push(jobId);
    },
    failExhausted: async (jobId) => {
      calls.failExhausted.push(jobId);
    },
    nowMs: () => 1_000_000,
    ...overrides,
  };
}

const opts = {
  heartbeat: DEFAULT_HEARTBEAT_CONFIG,
  jobTimeoutMs: 600_000,
  maxAttempts: 3,
};

describe("recoverStaleJobs", () => {
  it("não toca em jobs saudáveis (heartbeat recente)", async () => {
    const deps = makeDeps({
      listRunning: async () => [
        { id: "j1", orgId: "o", startedAt: new Date(900_000).toISOString() },
      ],
      lastHeartbeatAt: async () => new Date(990_000).toISOString(),
    });
    const report = await recoverStaleJobs("o", deps, opts);
    expect(report).toEqual({ scanned: 1, requeued: [], failedTimeout: [], failedExhausted: [] });
    expect(deps.calls.requeue).toEqual([]);
  });

  it("timeout tem precedência sobre órfão", async () => {
    const deps = makeDeps({
      listRunning: async () => [
        { id: "j1", orgId: "o", startedAt: new Date(1_000_000 - 700_000).toISOString() },
      ],
    });
    const report = await recoverStaleJobs("o", deps, opts);
    expect(report.failedTimeout).toEqual(["j1"]);
    expect(deps.calls.failAsTimeout).toEqual(["j1"]);
    expect(deps.calls.requeue).toEqual([]);
  });

  it("órfão com orçamento ⇒ requeue", async () => {
    const deps = makeDeps({
      listRunning: async () => [
        { id: "j1", orgId: "o", startedAt: new Date(900_000).toISOString() },
      ],
      lastHeartbeatAt: async () => new Date(800_000).toISOString(), // 200s sem heartbeat
      failedAttempts: async () => 1,
    });
    const report = await recoverStaleJobs("o", deps, opts);
    expect(report.requeued).toEqual(["j1"]);
    expect(deps.calls.requeue).toEqual(["j1"]);
  });

  it("órfão sem orçamento ⇒ FAILED + dead-letter", async () => {
    const deps = makeDeps({
      listRunning: async () => [
        { id: "j1", orgId: "o", startedAt: new Date(900_000).toISOString() },
      ],
      lastHeartbeatAt: async () => null,
      failedAttempts: async () => 3,
    });
    const report = await recoverStaleJobs("o", deps, opts);
    expect(report.failedExhausted).toEqual(["j1"]);
    expect(deps.calls.failExhausted).toEqual(["j1"]);
    expect(deps.calls.requeue).toEqual([]);
  });

  it("varre vários jobs e conta o relatório", async () => {
    const deps = makeDeps({
      listRunning: async () => [
        { id: "j1", orgId: "o", startedAt: new Date(900_000).toISOString() }, // saudável
        { id: "j2", orgId: "o", startedAt: new Date(900_000).toISOString() }, // órfão → requeue
        { id: "j3", orgId: "o", startedAt: new Date(200_000).toISOString() }, // timeout
      ],
      lastHeartbeatAt: async (jobId) =>
        jobId === "j1" ? new Date(995_000).toISOString() : new Date(800_000).toISOString(),
    });
    const report = await recoverStaleJobs("o", deps, opts);
    expect(report.scanned).toBe(3);
    expect(report.requeued).toEqual(["j2"]);
    expect(report.failedTimeout).toEqual(["j3"]);
  });
});
