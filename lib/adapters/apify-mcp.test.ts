/**
 * Athena Tools Hub — adapter Apify MCP (honestidade do esqueleto).
 *
 * Regras duras: o esqueleto contract-first NUNCA simula sucesso de
 * execução; o teto de gasto (maxCostCents) é OBRIGATÓRIO na validação;
 * a integração Apify via ScalaFlow nunca é tocada.
 * `execute()` deve lançar NOT_IMPLEMENTED (501). Sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import { ApifyMcpAdapter } from "./apify-mcp";

const adapter = new ApifyMcpAdapter();

describe("ApifyMcpAdapter.execute — honestidade", () => {
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

  it("executionReady é false — nenhuma conexão MCP dedicada", () => {
    expect(adapter.executionReady).toBe(false);
  });

  it("id e capabilities do contrato", () => {
    expect(adapter.id).toBe("apify-mcp");
    expect(adapter.capabilities).toContain("research.run");
  });

  it("está registrado no registry global", () => {
    expect(toolRegistry.get("apify-mcp")).toBeDefined();
  });
});

describe("ApifyMcpAdapter.validateParams — teto de gasto obrigatório", () => {
  it("aceita params válidos com maxCostCents", () => {
    const r = adapter.validateParams({
      actor: "apify/web-scraper",
      params: { startUrls: ["https://example.com"] },
      maxCostCents: 500,
    });
    expect(r.ok).toBe(true);
  });

  it("REJEITA sem maxCostCents (sem teto, sem execução)", () => {
    const r = adapter.validateParams({
      actor: "apify/web-scraper",
      params: {},
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/maxCostCents/);
  });

  it("REJEITA maxCostCents zerado", () => {
    const r = adapter.validateParams({
      actor: "apify/web-scraper",
      maxCostCents: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("rejeita sem actor", () => {
    const r = adapter.validateParams({ maxCostCents: 100 });
    expect(r.ok).toBe(false);
  });
});

describe("ApifyMcpAdapter.dryRunInfo — honestidade", () => {
  it("exige aprovação (consumo pago)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});
