/**
 * Testes do registo de motores (lib/re/engines.ts).
 * Garante o estado honesto: nada é READY sem prova; REA nasce NOT_CONFIGURED.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { getEngine, listEngines, REA_VERIFICATION, requireReaEngine } from "./engines";

describe("listEngines", () => {
  it("regista os dois motores com estados honestos", () => {
    const engines = listEngines();
    expect(engines.map((e) => e.id).sort()).toEqual(["rea", "static-local"]);
    expect(getEngine("static-local").status).toBe("READY");
    expect(getEngine("rea").status).toBe("NOT_CONFIGURED");
  });

  it("static-local tem prova real datada", () => {
    const local = getEngine("static-local");
    expect(local.lastVerifiedAt).toBe("2026-10-18");
    expect(local.notes).toContain("vitest");
  });

  it("rea nunca expõe estado READY/SIMULATED sem teste real", () => {
    const rea = getEngine("rea");
    expect(["READY", "SIMULATED"]).not.toContain(rea.status);
    expect(rea.lastVerifiedAt).toBeUndefined();
  });
});

describe("requireReaEngine", () => {
  it("lança NOT_IMPLEMENTED em vez de simular", () => {
    try {
      requireReaEngine();
      expect.unreachable("devia ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("NOT_IMPLEMENTED");
    }
  });
});

describe("REA_VERIFICATION", () => {
  it("documenta o confirmado e o NÃO verificado", () => {
    expect(REA_VERIFICATION.confirmed.length).toBeGreaterThan(0);
    expect(REA_VERIFICATION.notVerified.length).toBeGreaterThan(0);
    expect(
      REA_VERIFICATION.confirmed.join(" "),
    ).toContain("MIT");
  });

  it("lista requisitos de motores externos por alvo", () => {
    expect(REA_VERIFICATION.engineRequirements.join(" ")).toContain("Ghidra");
  });

  it("alerta sobre o repositório look-alike", () => {
    expect(REA_VERIFICATION.securityNotes.join(" ")).toContain("look-alike");
  });
});
