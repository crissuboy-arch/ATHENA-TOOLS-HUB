/**
 * Athena Tools Hub — adapter HyperFrames (honestidade do esqueleto).
 *
 * Regra dura: o esqueleto contract-first NUNCA simula sucesso de execução
 * e NUNCA anuncia geração de avatares de IA como capacidade nativa.
 * `execute()` deve lançar NOT_IMPLEMENTED (501). Sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import { HyperFramesAdapter } from "./hyperframes";

const adapter = new HyperFramesAdapter();

describe("HyperFramesAdapter.execute — honestidade", () => {
  it("execute() LANÇA NOT_IMPLEMENTED (501), nunca simula sucesso", async () => {
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

  it("executionReady é false — nenhum executor de renderização conectado", () => {
    expect(adapter.executionReady).toBe(false);
  });

  it("id, version e capabilities do contrato (sem avatares de IA)", () => {
    expect(adapter.id).toBe("hyperframes");
    expect(adapter.capabilities).toContain("video.render");
    expect(adapter.capabilities.join(" ")).not.toMatch(/avatar/i);
  });

  it("está registrado no registry global", () => {
    expect(toolRegistry.get("hyperframes")).toBeDefined();
  });
});

describe("HyperFramesAdapter.validateParams (contrato real)", () => {
  it("aceita params válidos", () => {
    const r = adapter.validateParams({
      model: "padrao",
      format: "9:16",
      text: "Olá, mundo",
      durationSeconds: 15,
    });
    expect(r.ok).toBe(true);
  });

  it("rejeita formato inválido", () => {
    const r = adapter.validateParams({
      model: "padrao",
      format: "21:9",
      text: "Olá",
    });
    expect(r.ok).toBe(false);
  });

  it("rejeita sem texto", () => {
    const r = adapter.validateParams({ model: "padrao", format: "1:1" });
    expect(r.ok).toBe(false);
  });
});

describe("HyperFramesAdapter.dryRunInfo — honestidade", () => {
  it("exige aprovação (renderização externa pode gerar custo)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});
