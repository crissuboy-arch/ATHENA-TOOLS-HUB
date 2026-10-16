/**
 * Athena Tools Hub — adapter VectorCraft (honestidade do esqueleto).
 *
 * Regra dura: o esqueleto contract-first NUNCA simula sucesso de execução.
 * `execute()` deve lançar NOT_IMPLEMENTED (501). Sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import { VectorCraftAdapter } from "./vectorcraft";

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
