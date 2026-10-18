/**
 * Athena Tools Hub — adapter VectorCraft (honestidade + contrato real).
 *
 * Regras duras: o adapter NUNCA simula sucesso de execução; o binário
 * Rust/CLI/MCP roda num worker isolado, nunca no frontend. `execute()`
 * deve lançar NOT_IMPLEMENTED (501). Sem rede, sem Supabase.
 * Contrato real confirmado no README de storytold/vectorcraft
 * (licença MIT OR Apache-2.0): `vectorcraft-cli mcp` (stdio) e
 * `vectorcraft-cli run --in <doc> --export <out>`.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import {
  buildCliJobSpec,
  buildMcpServerSpec,
  resolveVectorCraftConfig,
  VectorCraftAdapter,
  type VectorCraftConfig,
} from "./vectorcraft";

const adapter = new VectorCraftAdapter();

describe("VectorCraftAdapter.execute — honestidade", () => {
  it("execute() LANÇA NOT_IMPLEMENTED (501), nunca simula sucesso", async () => {
    await expect(adapter.execute()).rejects.toThrow(HubError);
    try {
      await adapter.execute();
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("NOT_IMPLEMENTED");
      expect(hub.status).toBe(501);
    }
  });

  it("executionReady é false — nenhum executor real conectado", () => {
    expect(adapter.executionReady).toBe(false);
  });

  it("id, version e capabilities do contrato", () => {
    expect(adapter.id).toBe("vectorcraft");
    expect(adapter.capabilities).toContain("vector.generate");
  });
});

describe("VectorCraftAdapter.validateParams (contrato real)", () => {
  it("aceita params válidos", () => {
    const r = adapter.validateParams({ prompt: "logo minimalista", width: 512 });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
  it("rejeita prompt ausente", () => {
    const r = adapter.validateParams({ width: 512 });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("rejeita dimensões fora do limite", () => {
    const r = adapter.validateParams({ prompt: "x", width: 99999 });
    expect(r.ok).toBe(false);
  });
});

describe("resolveVectorCraftConfig — sem credenciais hardcoded", () => {
  it("não configurado sem VECTORCRAFT_CLI", () => {
    const cfg = resolveVectorCraftConfig({});
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toMatch(/VECTORCRAFT_CLI/);
  });

  it("configurado com VECTORCRAFT_CLI + roots opcionais", () => {
    const cfg = resolveVectorCraftConfig({
      VECTORCRAFT_CLI: "/opt/vc/vectorcraft-cli",
      VECTORCRAFT_READ_ROOT: "/work/in",
      VECTORCRAFT_WRITE_ROOT: "/work/out",
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.binaryPath).toBe("/opt/vc/vectorcraft-cli");
    expect(cfg.readRoot).toBe("/work/in");
    expect(cfg.writeRoot).toBe("/work/out");
  });
});

describe("buildCliJobSpec — contrato real do CLI headless", () => {
  const cfg: VectorCraftConfig = {
    configured: true,
    binaryPath: "/opt/vc/vectorcraft-cli",
  };

  it("monta `run --in <doc> --export <out>`", () => {
    const spec = buildCliJobSpec(cfg, "/work/a.vectorcraft", "/work/a.svg", "svg");
    expect(spec.mustRunOn).toBe("isolated-worker");
    expect(spec.binary).toBe("/opt/vc/vectorcraft-cli");
    expect(spec.args).toEqual([
      "run",
      "--in",
      "/work/a.vectorcraft",
      "--export",
      "/work/a.svg",
    ]);
    expect(spec.timeoutMs).toBeGreaterThan(0);
  });

  it("REJEITA extensão incompatível com o formato", () => {
    expect(() =>
      buildCliJobSpec(cfg, "/work/a.vectorcraft", "/work/a.png", "svg"),
    ).toThrow(HubError);
  });

  it("sem config: lança NOT_IMPLEMENTED (501 honesto)", () => {
    const bad = resolveVectorCraftConfig({});
    try {
      buildCliJobSpec(bad, "/work/a.vectorcraft", "/work/a.svg", "svg");
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("NOT_IMPLEMENTED");
    }
  });
});

describe("buildMcpServerSpec — contrato real do servidor MCP", () => {
  it("monta `mcp` com roots confinados (flags reais do README)", () => {
    const cfg: VectorCraftConfig = {
      configured: true,
      binaryPath: "/opt/vc/vectorcraft-cli",
      readRoot: "/work/in",
      writeRoot: "/work/out",
    };
    const spec = buildMcpServerSpec(cfg);
    expect(spec.transport).toBe("stdio");
    expect(spec.mustRunOn).toBe("isolated-worker");
    expect(spec.command).toBe("/opt/vc/vectorcraft-cli");
    expect(spec.args).toEqual([
      "mcp",
      "--automation-read-root",
      "/work/in",
      "--automation-write-root",
      "/work/out",
    ]);
  });

  it("sem roots: só `mcp`", () => {
    const cfg: VectorCraftConfig = {
      configured: true,
      binaryPath: "/opt/vc/vectorcraft-cli",
    };
    expect(buildMcpServerSpec(cfg).args).toEqual(["mcp"]);
  });
});

describe("VectorCraftAdapter.dryRunInfo", () => {
  it("exige aprovação humana até o executor ser validado", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});

describe("toolRegistry", () => {
  it("vectorcraft está registrado via import do index", () => {
    expect(toolRegistry.get("vectorcraft")).toBeDefined();
    expect(toolRegistry.adapterFor("vectorcraft")?.executionReady).toBe(false);
  });
  it("tool desconhecida retorna undefined", () => {
    expect(toolRegistry.get("nao-existe")).toBeUndefined();
  });
});
