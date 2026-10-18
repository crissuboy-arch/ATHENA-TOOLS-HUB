/**
 * Testes dos limites rígidos (lib/re/config.ts).
 * Sem rede, sem I/O — só resolução e clamping de limites.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { DEFAULT_LIMITS, HARD_CEILINGS, resolveLimits } from "./config";

describe("DEFAULT_LIMITS", () => {
  it("tem defaults conservadores documentados", () => {
    expect(DEFAULT_LIMITS.maxUploadBytes).toBe(25 * 1024 * 1024); // alinhado com RE_MAX_UPLOAD_MB
    expect(DEFAULT_LIMITS.timeoutMs).toBe(60_000);
    expect(DEFAULT_LIMITS.maxMemoryBytes).toBe(512 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxCpuSeconds).toBe(60);
    expect(DEFAULT_LIMITS.maxDiskBytes).toBe(100 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxStrings).toBe(5_000);
    expect(DEFAULT_LIMITS.minStringLength).toBe(4);
  });

  it("não expõe nenhuma opção de rede", () => {
    expect("allowNetwork" in DEFAULT_LIMITS).toBe(false);
    expect("network" in DEFAULT_LIMITS).toBe(false);
  });
});

describe("resolveLimits", () => {
  it("sem overrides devolve defaults e clamped vazio", () => {
    const { limits, clamped } = resolveLimits();
    expect(limits).toEqual(DEFAULT_LIMITS);
    expect(clamped).toEqual([]);
  });

  it("aplica overrides abaixo do teto", () => {
    const { limits, clamped } = resolveLimits({ timeoutMs: 120_000, maxStrings: 1000 });
    expect(limits.timeoutMs).toBe(120_000);
    expect(limits.maxStrings).toBe(1000);
    expect(clamped).toEqual([]);
  });

  it("reduz (clamp) overrides acima do teto rígido e reporta", () => {
    const { limits, clamped } = resolveLimits({
      timeoutMs: 999_999_999,
      maxUploadBytes: 999 * 1024 * 1024,
    });
    expect(limits.timeoutMs).toBe(HARD_CEILINGS.timeoutMs);
    expect(limits.maxUploadBytes).toBe(HARD_CEILINGS.maxUploadBytes);
    expect(clamped).toContain("timeoutMs");
    expect(clamped).toContain("maxUploadBytes");
  });

  it("rejeita limites inválidos (zero, negativos, NaN)", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveLimits({ timeoutMs: bad })).toThrowError(HubError);
    }
  });

  it("aceita subconjunto de allowedKinds", () => {
    const { limits } = resolveLimits({ allowedKinds: ["zip", "png"] });
    expect(limits.allowedKinds).toEqual(["zip", "png"]);
  });

  it("rejeita allowedKinds vazio ou com formato desconhecido", () => {
    expect(() => resolveLimits({ allowedKinds: [] })).toThrowError(HubError);
    expect(() =>
      resolveLimits({ allowedKinds: ["zip", "exe"] as never }),
    ).toThrowError(HubError);
  });
});
