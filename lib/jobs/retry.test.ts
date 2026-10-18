/**
 * Testes da política de retries (puros, sem I/O).
 * `npx vitest run lib/jobs/retry.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  attemptsRemaining,
  computeBackoffDelayMs,
  DEFAULT_RETRY_POLICY,
  shouldRetry,
  validateRetryPolicy,
  type RetryPolicy,
} from "./retry";

const noJitter = () => 0.5; // random() = 0.5 ⇒ jitter zero

describe("computeBackoffDelayMs", () => {
  it("cresce exponencialmente (sem jitter)", () => {
    const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0 };
    expect(computeBackoffDelayMs(1, p, noJitter)).toBe(2000);
    expect(computeBackoffDelayMs(2, p, noJitter)).toBe(4000);
    expect(computeBackoffDelayMs(3, p, noJitter)).toBe(8000);
  });

  it("respeita o teto maxDelayMs", () => {
    const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0, maxDelayMs: 5000 };
    expect(computeBackoffDelayMs(10, p, noJitter)).toBe(5000);
  });

  it("jitter fica dentro de ±jitterRatio", () => {
    const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0.25 };
    const base = 2000;
    const low = computeBackoffDelayMs(1, p, () => 0); // -25%
    const high = computeBackoffDelayMs(1, p, () => 1); // +25%
    expect(low).toBe(Math.round(base * 0.75));
    expect(high).toBe(Math.round(base * 1.25));
    for (let i = 0; i < 50; i++) {
      const d = computeBackoffDelayMs(2, p);
      expect(d).toBeGreaterThanOrEqual(Math.round(4000 * 0.75));
      expect(d).toBeLessThanOrEqual(Math.round(4000 * 1.25));
    }
  });

  it("tentativa < 1 devolve 0", () => {
    expect(computeBackoffDelayMs(0, DEFAULT_RETRY_POLICY, noJitter)).toBe(0);
  });

  it("nunca devolve negativo", () => {
    const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 1 };
    expect(computeBackoffDelayMs(1, p, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("shouldRetry / attemptsRemaining", () => {
  it("permite enquanto houver orçamento", () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(2)).toBe(true); // maxAttempts=3
    expect(shouldRetry(3)).toBe(false);
    expect(shouldRetry(99)).toBe(false);
  });

  it("conta tentativas restantes", () => {
    expect(attemptsRemaining(0)).toBe(3);
    expect(attemptsRemaining(3)).toBe(0);
    expect(attemptsRemaining(10)).toBe(0);
  });
});

describe("validateRetryPolicy", () => {
  it("aceita a política padrão", () => {
    expect(validateRetryPolicy(DEFAULT_RETRY_POLICY)).toEqual([]);
  });

  it("rejeita valores absurdos", () => {
    const errors = validateRetryPolicy({
      maxAttempts: 0,
      baseDelayMs: -1,
      maxDelayMs: 10,
      multiplier: 0.5,
      jitterRatio: 2,
    });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});
