/**
 * FASE 4 — testes do modelo de 6 estados honestos.
 *
 * Regras duras sob teste:
 * - adapter 501 (executionReady = false) NUNCA resulta em READY;
 * - sem histórico de execução real, o teto é CONNECTED;
 * - CONNECTED ≠ READY;
 * - nada é inventado: sem evidência, o estado é NOT_CONFIGURED.
 */

import { describe, expect, it } from "vitest";
import {
  LEGACY_STATE_TO_HEALTH,
  mapLegacyStateToHealth,
  type ToolState,
} from "./types";
import { TOOLS } from "./tools";
import {
  deriveStateFromSignals,
  getToolHealth,
  resolveToolState,
  type ToolHealthSignals,
} from "./health";

const BASE_SIGNALS: ToolHealthSignals = {
  adapterRegistered: false,
  executionReady: false,
  configured: false,
  lastRealRunOk: null,
  hadRealSuccessBefore: false,
  simulated: false,
  knownError: null,
};

describe("mapLegacyStateToHealth — migração honesta", () => {
  const cases: Array<[ToolState, string]> = [
    ["cataloged", "NOT_CONFIGURED"],
    ["needs-config", "NOT_CONFIGURED"],
    ["in-development", "NOT_CONFIGURED"],
    ["connected", "CONNECTED"],
    ["operational-tested", "READY"],
    ["error", "ERROR"],
    // "unavailable" não tem equivalente saudável: ferramentas indisponíveis
    // não entram no catálogo; o mapeamento cai em ERROR, nunca em READY.
    ["unavailable", "ERROR"],
  ];
  for (const [legacy, expected] of cases) {
    it(`"${legacy}" → ${expected}`, () => {
      expect(mapLegacyStateToHealth(legacy)).toBe(expected);
      expect(LEGACY_STATE_TO_HEALTH[legacy]).toBe(expected);
    });
  }

  it("nenhum legado mapeia para READY sem ser 'operational-tested'", () => {
    for (const [legacy, mapped] of Object.entries(LEGACY_STATE_TO_HEALTH)) {
      if (legacy !== "operational-tested") {
        expect(mapped).not.toBe("READY");
      }
    }
  });
});

describe("deriveStateFromSignals — máquina de estados", () => {
  it("sem nenhum sinal → NOT_CONFIGURED (nada inventado)", () => {
    const r = deriveStateFromSignals(BASE_SIGNALS);
    expect(r.state).toBe("NOT_CONFIGURED");
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("READY exige executor pronto + configurado + execução real comprovada", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      adapterRegistered: true,
      executionReady: true,
      configured: true,
      lastRealRunOk: true,
    });
    expect(r.state).toBe("READY");
  });

  it("sem histórico de execução real, o teto é CONNECTED (nunca READY)", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      adapterRegistered: true,
      executionReady: true,
      configured: true,
      lastRealRunOk: null,
    });
    expect(r.state).toBe("CONNECTED");
  });

  it("configurado sem execução real → CONNECTED, e CONNECTED ≠ READY", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      adapterRegistered: true,
      configured: true,
    });
    expect(r.state).toBe("CONNECTED");
    expect(r.state).not.toBe("READY");
  });

  it("erro conhecido → ERROR com o motivo preservado", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      knownError: "executor fora do ar",
    });
    expect(r.state).toBe("ERROR");
    expect(r.reason).toContain("executor fora do ar");
  });

  it("última execução real falhou após sucesso anterior → DEGRADED", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      executionReady: true,
      configured: true,
      lastRealRunOk: false,
      hadRealSuccessBefore: true,
    });
    expect(r.state).toBe("DEGRADED");
  });

  it("última execução real falhou sem sucesso anterior → ERROR", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      lastRealRunOk: false,
      hadRealSuccessBefore: false,
    });
    expect(r.state).toBe("ERROR");
  });

  it("execução declaradamente simulada, sem sucesso real → SIMULATED", () => {
    const r = deriveStateFromSignals({ ...BASE_SIGNALS, simulated: true });
    expect(r.state).toBe("SIMULATED");
  });

  it("erro conhecido tem prioridade sobre simulação e configuração", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      configured: true,
      simulated: true,
      knownError: "falha de autenticação",
    });
    expect(r.state).toBe("ERROR");
  });

  it("sucesso real histórico + adapter 501 atual → NÃO é READY (revalidação pendente)", () => {
    const r = deriveStateFromSignals({
      ...BASE_SIGNALS,
      adapterRegistered: true,
      executionReady: false,
      configured: true,
      lastRealRunOk: true,
    });
    expect(r.state).not.toBe("READY");
    expect(r.state).toBe("CONNECTED");
    expect(r.reason).toMatch(/revalidação/i);
  });
});

describe("resolveToolState / getToolHealth — retrato honesto de hoje", () => {
  it("as 12 ferramentas do catálogo resolvem para NOT_CONFIGURED sem evidência", () => {
    expect(TOOLS).toHaveLength(12); // 11 originais + mkvideos (FASE 6, registo explícito da missão)
    for (const tool of TOOLS) {
      const h = resolveToolState(tool);
      expect(h.found).toBe(true);
      expect(h.state).toBe("NOT_CONFIGURED");
      expect(h.reason.length).toBeGreaterThan(0);
      expect(h.legacyState).toBe(tool.state);
      expect(h.legacyMappedState).toBe(mapLegacyStateToHealth(tool.state));
    }
  });

  it("nenhuma ferramenta com adapter 501 pode ser READY", () => {
    // HyperFrames SAIU deste grupo em 2026-10-28 (executor real 0.3.0-worker,
    // primeira execução provada) — restam os 501 puros.
    for (const id of ["vectorcraft", "apify-mcp"]) {
      const h = getToolHealth(id, {
        configured: true,
        lastRealRunOk: true,
        hadRealSuccessBefore: true,
      });
      expect(h.signals?.executionReady).toBe(false);
      expect(h.state).not.toBe("READY");
    }
  });

  it("adapters 501 expõem a versão do contrato, sem fingir executor", () => {
    // Versões pinadas pela FASE 6 (contratos estendidos); mkvideos nasce em 0.1.0.
    // HyperFrames NÃO está aqui: tem executor real desde 0.3.0-worker.
    const expected: Record<string, string> = {
      vectorcraft: "0.2.0-contract",
      "apify-mcp": "0.2.0-contract",
      mkvideos: "0.1.0-contract",
    };
    for (const [id, version] of Object.entries(expected)) {
      const h = getToolHealth(id);
      expect(h.contractVersion).toBe(version);
      expect(h.signals?.adapterRegistered).toBe(true);
      expect(h.signals?.executionReady).toBe(false);
    }
  });

  it("hyperframes 0.3.0-worker: executor real, gate por env (nunca fingido)", () => {
    const saved = process.env["HYPERFRAMES_WORKER_ENABLED"];
    try {
      delete process.env["HYPERFRAMES_WORKER_ENABLED"];
      const off = getToolHealth("hyperframes");
      expect(off.contractVersion).toBe("0.3.0-worker");
      expect(off.signals?.adapterRegistered).toBe(true);
      expect(off.signals?.executionReady).toBe(false);
      process.env["HYPERFRAMES_WORKER_ENABLED"] = "1";
      const on = getToolHealth("hyperframes");
      expect(on.contractVersion).toBe("0.3.0-worker");
      expect(on.signals?.executionReady).toBe(true);
    } finally {
      if (saved === undefined) delete process.env["HYPERFRAMES_WORKER_ENABLED"];
      else process.env["HYPERFRAMES_WORKER_ENABLED"] = saved;
    }
  });

  it("ferramentas sem adapter têm contractVersion null", () => {
    const h = getToolHealth("designcraft");
    expect(h.contractVersion).toBeNull();
    expect(h.signals?.adapterRegistered).toBe(false);
  });

  it("id inexistente → found:false, sem inventar estado", () => {
    const h = getToolHealth("ferramenta-que-nao-existe");
    expect(h.found).toBe(false);
    expect(h.state).toBeNull();
    expect(h.signals).toBeNull();
  });

  it("configurado=true eleva para CONNECTED, mas nunca para READY sem execução real", () => {
    const h = getToolHealth("supabase", { configured: true });
    expect(h.state).toBe("CONNECTED");
    expect(h.state).not.toBe("READY");
  });
});

describe("TOOLS — facetas FASE 4 completas e honestas", () => {
  it("todas as ferramentas expõem as 9 facetas (null = não especificado)", () => {
    for (const tool of TOOLS) {
      expect(tool, tool.id).toHaveProperty("version");
      expect(tool, tool.id).toHaveProperty("technicalProfile");
      expect(tool, tool.id).toHaveProperty("io");
      expect(tool, tool.id).toHaveProperty("executor");
      expect(tool, tool.id).toHaveProperty("permissions");
      expect(tool, tool.id).toHaveProperty("limits");
      expect(tool, tool.id).toHaveProperty("logs");
      expect(tool, tool.id).toHaveProperty("tests");
      expect(tool, tool.id).toHaveProperty("history");
    }
  });

  it("nenhuma ferramenta declara executor real hoje", () => {
    for (const tool of TOOLS) {
      expect(tool.executor, tool.id).toBeNull();
    }
  });

  it("nenhuma ferramenta inventa histórico de execução", () => {
    for (const tool of TOOLS) {
      expect(tool.history, tool.id).toBeNull();
    }
  });

  it("só os 3 adapters têm io tipado transcrito do contrato", () => {
    const withIo = TOOLS.filter((t) => t.io !== null).map((t) => t.id);
    expect(withIo.sort()).toEqual(["apify-mcp", "hyperframes", "vectorcraft"]);
    for (const tool of TOOLS.filter((t) => t.io !== null)) {
      expect(tool.io!.inputs!.length).toBeGreaterThan(0);
      // outputs honestamente não especificados: executor pendente
      expect(tool.io!.outputs).toBeNull();
    }
  });

  it("só ferramentas autorizadas no catálogo: 11 originais + mkvideos (FASE 6)", () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(
      [
        "apify-mcp",
        "artcraft",
        "designcraft",
        "gws-cli",
        "hyperframes",
        "lightcraft",
        "mkvideos",
        "photocraft",
        "playwright-cli",
        "supabase",
        "vectorcraft",
        "wordcraft",
      ].sort(),
    );
  });
});
