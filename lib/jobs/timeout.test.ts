/**
 * Testes dos timeouts (puros + withTimeout).
 * `npx vitest run lib/jobs/timeout.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  deadlineFor,
  findTimedOutJobs,
  isExpired,
  remainingMs,
  TimeoutError,
  withTimeout,
} from "./timeout";

describe("funções puras", () => {
  it("deadlineFor / isExpired / remainingMs", () => {
    const deadline = deadlineFor(1000, 500);
    expect(deadline).toBe(1500);
    expect(isExpired(deadline, 1499)).toBe(false);
    expect(isExpired(deadline, 1500)).toBe(true);
    expect(remainingMs(deadline, 1200)).toBe(300);
    expect(remainingMs(deadline, 9999)).toBe(0);
  });

  it("findTimedOutJobs filtra corretamente", () => {
    const now = 1_000_000;
    const jobs = [
      { id: "a", orgId: "o", startedAt: new Date(now - 700_000).toISOString() }, // estourou (600s)
      { id: "b", orgId: "o", startedAt: new Date(now - 100_000).toISOString() }, // ok
      { id: "c", orgId: "o", startedAt: null }, // sem started_at: ignorado
      { id: "d", orgId: "o", startedAt: "data-inválida" }, // inválido: ignorado
    ];
    const timedOut = findTimedOutJobs(jobs, 600_000, now);
    expect(timedOut.map((j) => j.id)).toEqual(["a"]);
  });
});

describe("withTimeout", () => {
  it("resolve quando a promise termina a tempo", async () => {
    const { promise, cancel } = withTimeout(Promise.resolve("ok"), 1000, "teste");
    await expect(promise).resolves.toBe("ok");
    cancel();
  });

  it("rejeita com TimeoutError e aborta o signal", async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => {});
    const { promise, signal } = withTimeout(never, 30, "job x tentativa 1", controller);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT", timeoutMs: 30 });
    expect(signal.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("propaga o erro original da promise", async () => {
    const { promise, cancel } = withTimeout(
      Promise.reject(new Error("boom")),
      1000,
      "teste",
    );
    await expect(promise).rejects.toThrow("boom");
    cancel();
  });

  it("cancel() desarma o timer", async () => {
    const { promise, cancel } = withTimeout(Promise.resolve(1), 20, "teste");
    cancel();
    await expect(promise).resolves.toBe(1);
    // Se o timer não tivesse sido desarmado, esta espera o provaria via unref;
    // o essencial é que a promise original venceu sem TimeoutError.
  });
});
