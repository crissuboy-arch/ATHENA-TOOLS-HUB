/**
 * Athena Tools Hub — adapter Apify MCP (honestidade + guardrails).
 *
 * Regras duras: o adapter NUNCA simula sucesso de execução; o teto de
 * gasto (maxCostCents) é OBRIGATÓRIO na validação; a integração Apify via
 * ScalaFlow nunca é tocada; nenhuma segunda assinatura é criada.
 * `execute()` deve lançar NOT_IMPLEMENTED (501). Sem rede, sem Supabase.
 * Guardrails (orçamento, ledger) são funções puras e testadas aqui.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import {
  apifyDatasetItemsUrl,
  apifyRunStatusUrl,
  apifyRunUrl,
  ApifyMcpAdapter,
  assertExecutionAllowed,
  checkBudget,
  monthSpendCents,
  recordRunFinish,
  recordRunStart,
  resolveApifyConfig,
  type ApifyBudget,
  type ApifyLedger,
} from "./apify-mcp";

const adapter = new ApifyMcpAdapter();
const NOW = "2026-10-18T12:00:00.000Z";

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

describe("resolveApifyConfig — sem credenciais hardcoded", () => {
  it("NOT_CONFIGURED sem APIFY_TOKEN", () => {
    const cfg = resolveApifyConfig({});
    expect(cfg.configured).toBe(false);
    expect(cfg.tokenPresent).toBe(false);
    expect(cfg.reason).toMatch(/APIFY_TOKEN/);
    expect(adapter.configStatus({}).status).toBe(
      "not_configured",
    );
  });

  it("configurado com token + tetos + allowlist", () => {
    const cfg = resolveApifyConfig({
      APIFY_TOKEN: "segredo-no-env",
      APIFY_ACTOR_ALLOWLIST: "apify/web-scraper, compass/crawler-google-places",
      APIFY_MONTHLY_CAP_CENTS: "5000",
      APIFY_PER_JOB_CAP_CENTS: "500",
    });
    expect(cfg.configured).toBe(true);
    expect(cfg.tokenPresent).toBe(true);
    expect(cfg.actorAllowlist).toEqual([
      "apify/web-scraper",
      "compass/crawler-google-places",
    ]);
    expect(cfg.monthlyCapCents).toBe(5000);
    expect(cfg.perJobCapCents).toBe(500);
  });
});

describe("checkBudget — limites de consumo (puro)", () => {
  const budget: ApifyBudget = {
    monthlyCapCents: 5000,
    perJobCapCents: 500,
    actorAllowlist: [],
  };

  it("permite dentro dos tetos", () => {
    expect(checkBudget(budget, [], 400, NOW).allowed).toBe(true);
  });

  it("BLOQUEIA acima do teto por job", () => {
    const r = checkBudget(budget, [], 600, NOW);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/por job/);
  });

  it("BLOQUEIA quando o mês estoura", () => {
    const ledger: ApifyLedger = [
      {
        runId: "r1",
        actor: "apify/web-scraper",
        status: "succeeded",
        startedAt: "2026-10-05T10:00:00.000Z",
        finishedAt: "2026-10-05T10:05:00.000Z",
        maxCostCents: 500,
        usageCents: 4800,
      },
    ];
    const r = checkBudget(budget, ledger, 400, NOW);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/mensal/);
  });

  it("sem tetos configurados: permite tudo", () => {
    const open: ApifyBudget = {
      monthlyCapCents: 0,
      perJobCapCents: 0,
      actorAllowlist: [],
    };
    expect(checkBudget(open, [], 999999, NOW).allowed).toBe(true);
  });
});

describe("monthSpendCents — soma só custos reais conhecidos", () => {
  it("ignora usageCents null (nunca inventa custo)", () => {
    const ledger: ApifyLedger = [
      {
        runId: "r1",
        actor: "a/b",
        status: "started",
        startedAt: "2026-10-18T10:00:00.000Z",
        maxCostCents: 100,
        usageCents: null,
      },
      {
        runId: "r2",
        actor: "a/b",
        status: "succeeded",
        startedAt: "2026-09-01T10:00:00.000Z",
        maxCostCents: 100,
        usageCents: 90,
      },
    ];
    expect(monthSpendCents(ledger, "2026-10")).toBe(0);
    expect(monthSpendCents(ledger, "2026-09")).toBe(90);
  });
});

describe("recordRunStart / recordRunFinish — registo imutável", () => {
  it("start → finish preserva o ledger original", () => {
    const l0: ApifyLedger = [];
    const l1 = recordRunStart(l0, {
      runId: "r1",
      actor: "apify/web-scraper",
      startedAt: NOW,
      maxCostCents: 500,
    });
    expect(l0).toHaveLength(0);
    expect(l1[0]!.status).toBe("started");
    expect(l1[0]!.usageCents).toBeNull();

    const l2 = recordRunFinish(l1, "r1", {
      status: "succeeded",
      finishedAt: NOW,
      usageCents: 320,
    });
    expect(l1[0]!.status).toBe("started");
    expect(l2[0]!.status).toBe("succeeded");
    expect(l2[0]!.usageCents).toBe(320);
  });
});

describe("assertExecutionAllowed — gate completo (puro)", () => {
  const params = {
    actor: "apify/web-scraper",
    params: {},
    maxCostCents: 400,
  };

  it("permite com config + orçamento OK", () => {
    const cfg = resolveApifyConfig({
      APIFY_TOKEN: "x",
      APIFY_PER_JOB_CAP_CENTS: "500",
    });
    expect(assertExecutionAllowed(params, cfg, [], NOW)).toEqual({ ok: true });
  });

  it("BLOQUEIA sem token (NOT_CONFIGURED honesto)", () => {
    const cfg = resolveApifyConfig({});
    expect(() => assertExecutionAllowed(params, cfg, [], NOW)).toThrow(HubError);
    try {
      assertExecutionAllowed(params, cfg, [], NOW);
    } catch (err) {
      expect((err as HubError).code).toBe("NOT_IMPLEMENTED");
    }
  });

  it("BLOQUEIA actor fora da allowlist", () => {
    const cfg = resolveApifyConfig({
      APIFY_TOKEN: "x",
      APIFY_ACTOR_ALLOWLIST: "apify/web-scraper",
    });
    expect(() =>
      assertExecutionAllowed(
        { ...params, actor: "outro/actor" },
        cfg,
        [],
        NOW,
      ),
    ).toThrow(/allowlist/);
  });

  it("BLOQUEIA teto de job excedido", () => {
    const cfg = resolveApifyConfig({
      APIFY_TOKEN: "x",
      APIFY_PER_JOB_CAP_CENTS: "100",
    });
    expect(() => assertExecutionAllowed(params, cfg, [], NOW)).toThrow(
      /orçamento/,
    );
  });
});

describe("URLs oficiais da API Apify (nada inventado)", () => {
  it("converte autor/actor → autor~actor no endpoint de runs", () => {
    expect(apifyRunUrl("apify/web-scraper")).toBe(
      "https://api.apify.com/v2/acts/apify~web-scraper/runs",
    );
  });

  it("status e dataset usam os paths oficiais", () => {
    expect(apifyRunStatusUrl("abc123")).toBe(
      "https://api.apify.com/v2/actor-runs/abc123",
    );
    expect(apifyDatasetItemsUrl("ds1")).toBe(
      "https://api.apify.com/v2/datasets/ds1/items",
    );
  });
});

describe("ApifyMcpAdapter.dryRunInfo — honestidade", () => {
  it("exige aprovação (consumo pago)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});
