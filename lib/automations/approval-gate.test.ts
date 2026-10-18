/**
 * Testes: portão de aprovação (reutiliza fluxo existente) e agendamento desativado.
 * `npx vitest run lib/automations/approval-gate.test.ts`
 */
import { describe, expect, it } from "vitest";
import { approvalGateFor, gateChecklist } from "./approval-gate";
import { allAutomationKinds } from "./types";

describe("approvalGateFor", () => {
  it("cobre todos os tipos de automação", () => {
    for (const kind of allAutomationKinds) {
      const gate = approvalGateFor(kind);
      expect(gate.fila).toBe("/api/v1/approvals");
      expect(gate.scope).toBe("approvals:decide");
      expect(gate.motivo.length).toBeGreaterThan(0);
    }
  });

  it("reel, público, relatório e publicação exigem aprovação", () => {
    expect(approvalGateFor("reel_pipeline").requiresApproval).toBe(true);
    expect(approvalGateFor("audience_video").requiresApproval).toBe(true);
    expect(approvalGateFor("campaign_report").requiresApproval).toBe(true);
    expect(approvalGateFor("scheduled_publish").requiresApproval).toBe(true);
  });

  it("pesquisa e preparo de conteúdo não exigem (sem efeito externo)", () => {
    expect(approvalGateFor("trend_research").requiresApproval).toBe(false);
    expect(approvalGateFor("content_prep").requiresApproval).toBe(false);
  });

  it("NÃO duplica o fluxo: aponta para a fila existente", () => {
    const gate = approvalGateFor("reel_pipeline");
    // O portão é declarativo; a decisão vive em /api/v1/approvals
    expect(gate.fila).toBe("/api/v1/approvals");
  });
});

describe("gateChecklist", () => {
  it("sempre inclui conferência de fontes/métricas", () => {
    const items = gateChecklist("reel_pipeline");
    expect(items.some((i) => i.includes("fonte"))).toBe(true);
  });

  it("publicação lembra que segue desativada", () => {
    const items = gateChecklist("scheduled_publish");
    expect(items.some((i) => i.includes("DESATIVADA"))).toBe(true);
  });
});
