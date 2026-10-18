/**
 * Testes: checklist de verificação de fontes/métricas ("conferir cada número").
 * `npx vitest run lib/automations/source-verification.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  createChecklist,
  setItemStatus,
  verdict,
  type SourceChecklist,
} from "./source-verification";

const NOW = "2026-10-18T12:00:00+01:00";

function fresh(): SourceChecklist {
  const r = createChecklist({
    id: "chk-1",
    alvoId: "job-viral-1",
    alvoTipo: "resultado_pesquisa",
    criadoEm: NOW,
  });
  if (!r.ok) throw new Error("checklist inválido no teste");
  return r.value;
}

describe("createChecklist", () => {
  it("cria com os itens padrão do tipo de alvo", () => {
    const c = fresh();
    expect(c.itens).toHaveLength(5);
    expect(c.itens.every((i) => i.status === "pendente")).toBe(true);
    expect(c.itens.map((i) => i.id)).toContain("metrica-cruzada");
  });

  it("itens variam por tipo de alvo", () => {
    const r = createChecklist({
      id: "chk-2",
      alvoId: "rel-1",
      alvoTipo: "relatorio",
      criadoEm: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.itens.map((i) => i.id)).toContain("metricas-verificadas");
  });
});

describe("setItemStatus", () => {
  it("pass exige evidência (regra anti-'confia')", () => {
    const r = setItemStatus(fresh(), "fonte-acessivel", {
      status: "pass",
      verificadoEm: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EVIDENCE_REQUIRED");
  });

  it("pass com evidência funciona", () => {
    const r = setItemStatus(fresh(), "fonte-acessivel", {
      status: "pass",
      evidencia: "URL abre; título confere (print 12:01).",
      verificadoEm: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const item = r.value.itens.find((i) => i.id === "fonte-acessivel");
      expect(item?.status).toBe("pass");
      expect(item?.evidencia).toContain("print");
    }
  });

  it("fail não exige evidência mas aceita", () => {
    const r = setItemStatus(fresh(), "metrica-cruzada", {
      status: "fail",
      evidencia: "Segunda fonte mostra número diferente.",
      verificadoEm: NOW,
    });
    expect(r.ok).toBe(true);
  });

  it("rejeita item inexistente", () => {
    const r = setItemStatus(fresh(), "nao-existe", {
      status: "pass",
      evidencia: "x",
      verificadoEm: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ITEM_NOT_FOUND");
  });
});

describe("verdict", () => {
  function approveAll(c: SourceChecklist): SourceChecklist {
    let cur = c;
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

  it("incompleto quando há pendentes", () => {
    expect(verdict(fresh()).veredito).toBe("incompleto");
  });

  it("aprovado só com todos pass", () => {
    const v = verdict(approveAll(fresh()));
    expect(v.veredito).toBe("aprovado");
    expect(v.pass).toBe(5);
    expect(v.pendentes).toHaveLength(0);
  });

  it("reprovado quando qualquer item falha", () => {
    let cur = approveAll(fresh());
    const r = setItemStatus(cur, "metrica-cruzada", {
      status: "fail",
      evidencia: "Número não bate.",
      verificadoEm: NOW,
    });
    if (!r.ok) throw new Error("falha no teste");
    cur = r.value;
    const v = verdict(cur);
    expect(v.veredito).toBe("reprovado");
    expect(v.fail).toBe(1);
  });
});
