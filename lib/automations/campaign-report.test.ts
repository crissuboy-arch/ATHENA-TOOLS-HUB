/**
 * Testes: relatório de campanha (histórico e resultados).
 * `npx vitest run lib/automations/campaign-report.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  buildReport,
  finalizeReport,
  reportLine,
} from "./campaign-report";
import {
  createChecklist,
  setItemStatus,
  type SourceChecklist,
} from "./source-verification";

const NOW = "2026-10-18T12:00:00+01:00";

const reportInput = {
  id: "camp-1",
  titulo: "Ofensiva Criativa — outubro",
  periodo: {
    inicio: "2026-10-01T00:00:00+01:00",
    fim: "2026-10-18T23:59:59+01:00",
  },
  automations: [
    {
      kind: "reel_pipeline",
      titulo: "Ep. 1",
      status: "ready",
      metricas: { visualizacoes: 1000, curtidas: 120 },
    },
    {
      kind: "trend_research",
      titulo: "Pesquisa nicho",
      status: "ready",
    },
  ],
  destaques: ["Ep. 1 acima da média de salvamentos."],
  geradoEm: NOW,
};

function approveChecklist(alvoId: string): SourceChecklist {
  const c = createChecklist({
    id: `chk-${alvoId}`,
    alvoId,
    alvoTipo: "relatorio",
    criadoEm: NOW,
  });
  if (!c.ok) throw new Error("checklist inválido no teste");
  let cur = c.value;
  for (const item of cur.itens) {
    const r = setItemStatus(cur, item.id, {
      status: "pass",
      evidencia: "verificado",
      verificadoEm: NOW,
    });
    if (!r.ok) throw new Error("falha ao aprovar item no teste");
    cur = r.value;
  }
  return cur;
}

describe("buildReport", () => {
  it("constrói rascunho agregando métricas", () => {
    const r = buildReport(reportInput);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("rascunho");
      expect(r.value.totais).toEqual({ visualizacoes: 1000, curtidas: 120 });
    }
  });

  it("rejeita período invertido", () => {
    const r = buildReport({
      ...reportInput,
      periodo: {
        inicio: "2026-10-18T00:00:00+01:00",
        fim: "2026-10-01T00:00:00+01:00",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejeita sem automações", () => {
    const r = buildReport({ ...reportInput, automations: [] });
    expect(r.ok).toBe(false);
  });
});

describe("finalizeReport", () => {
  it("finaliza quando métricas têm checklist aprovado", () => {
    const built = buildReport(reportInput);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = finalizeReport(built.value, [
      approveChecklist("camp-1:reel_pipeline"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("final");
  });

  it("recusa quando falta checklist para métricas", () => {
    const built = buildReport(reportInput);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = finalizeReport(built.value, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("MISSING_VERIFICATION");
  });

  it("recusa quando checklist não está aprovado", () => {
    const built = buildReport(reportInput);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const chk = createChecklist({
      id: "chk-x",
      alvoId: "camp-1:reel_pipeline",
      alvoTipo: "relatorio",
      criadoEm: NOW,
    });
    if (!chk.ok) return;
    const r = finalizeReport(built.value, [chk.value]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("UNVERIFIED_METRICS");
  });

  it("recusa com automação em rascunho", () => {
    const built = buildReport({
      ...reportInput,
      automations: [
        { kind: "reel_pipeline", titulo: "Ep. 2", status: "draft" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = finalizeReport(built.value, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PENDING_AUTOMATIONS");
  });

  it("não finaliza duas vezes", () => {
    const built = buildReport({
      ...reportInput,
      automations: [{ kind: "trend_research", titulo: "P", status: "ready" }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const once = finalizeReport(built.value, []);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = finalizeReport(once.value, []);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("ALREADY_FINAL");
  });
});

describe("reportLine", () => {
  it("gera linha legível com período e totais", () => {
    const built = buildReport(reportInput);
    expect(built.ok).toBe(true);
    if (built.ok) {
      const line = reportLine(built.value);
      expect(line).toContain("Ofensiva Criativa — outubro");
      expect(line).toContain("2026-10-01 → 2026-10-18");
      expect(line).toContain("visualizacoes: 1000");
    }
  });
});
