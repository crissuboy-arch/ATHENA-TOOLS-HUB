/**
 * Testes do MemoryJobStore — mesmo contrato do JobStore real, sem Supabase.
 * `npx vitest run lib/jobs/memory-store.test.ts`
 */
import { describe, expect, it } from "vitest";
import { MemoryJobStore } from "./memory-store";

const ORG = "org-a";
const OTHER_ORG = "org-b";

function seeded(store: MemoryJobStore, id = "job-1", orgId = ORG) {
  return store.seed({
    id,
    orgId,
    toolId: "hyperframes",
    params: { composition: { html: "<div>x</div>" } },
  });
}

describe("MemoryJobStore — fila e claim", () => {
  it("listQueued só devolve QUEUED da org pedida, por ordem de chegada", async () => {
    const store = new MemoryJobStore();
    seeded(store, "job-1", ORG);
    seeded(store, "job-2", OTHER_ORG);
    seeded(store, "job-3", ORG);
    const queued = await store.listQueued(ORG, 10);
    expect(queued.map((j) => j.id)).toEqual(["job-1", "job-3"]);
  });

  it("claim é atómico: segundo claim do mesmo job devolve false", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    expect(await store.claim("job-1", ORG, "w-1")).toBe(true);
    expect(await store.claim("job-1", ORG, "w-2")).toBe(false);
    expect((await store.get("job-1", ORG)).status).toBe("RUNNING");
  });

  it("claim fora da org LANÇA (como o 404 do Supabase)", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await expect(store.claim("job-1", OTHER_ORG, "w-1")).rejects.toThrow(/não encontrado/);
  });

  it("get fora da org LANÇA; dentro devolve o registo", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await expect(store.get("job-1", OTHER_ORG)).rejects.toThrow(/não encontrado/);
    const job = await store.get("job-1", ORG);
    expect(job.status).toBe("QUEUED");
    expect(job.toolId).toBe("hyperframes");
  });
});

describe("MemoryJobStore — transições e eventos", () => {
  it("RUNNING → COMPLETED guarda resultado e progresso 100", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await store.claim("job-1", ORG, "w-1");
    await store.updateProgress("job-1", ORG, 40);
    await store.complete("job-1", ORG, { artifactPath: "/tmp/x.mp4" });
    const snap = store.snapshot("job-1");
    expect(snap.status).toBe("COMPLETED");
    expect(snap.progress).toBe(100);
    expect(snap.result).toEqual({ artifactPath: "/tmp/x.mp4" });
  });

  it("COMPLETED não aceita nova transição (terminal)", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await store.claim("job-1", ORG, "w-1");
    await store.complete("job-1", ORG, {});
    await expect(store.complete("job-1", ORG, {})).rejects.toThrow(/transição inválida/);
    await expect(store.fail("job-1", ORG, {})).rejects.toThrow(/transição inválida/);
  });

  it("RUNNING → QUEUED (requeue de órfão) limpa startedAt", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await store.claim("job-1", ORG, "w-1");
    expect((await store.get("job-1", ORG)).startedAt).not.toBeNull();
    await store.requeue("job-1", ORG, "órfão");
    const snap = store.snapshot("job-1");
    expect(snap.status).toBe("QUEUED");
    expect(snap.startedAt).toBeNull();
  });

  it("eventos: heartbeat, contagem e lastHeartbeatAt", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    expect(await store.lastHeartbeatAt("job-1", ORG)).toBeNull();
    await store.heartbeat("job-1", ORG, "w-1");
    await store.event("job-1", ORG, "attempt_started", "tentativa 1/3", { attempt: 1 });
    expect(await store.countEvents("job-1", ORG, "heartbeat")).toBe(1);
    expect(await store.countEvents("job-1", ORG, "attempt_started")).toBe(1);
    expect(await store.lastHeartbeatAt("job-1", ORG)).not.toBeNull();
  });

  it("progresso é limitado a 0..100", async () => {
    const store = new MemoryJobStore();
    seeded(store);
    await store.updateProgress("job-1", ORG, 250);
    expect(store.snapshot("job-1").progress).toBe(100);
    await store.updateProgress("job-1", ORG, -5);
    expect(store.snapshot("job-1").progress).toBe(0);
  });
});
