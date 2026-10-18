/**
 * Testes: perfis de audiência e regras de adaptação (promoavatar).
 * `npx vitest run lib/automations/audience-profiles.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  adaptScriptForAudience,
  listAdaptationRules,
  validateAudienceProfile,
} from "./audience-profiles";

const profile = {
  id: "maes-empreendedoras",
  nome: "Mães empreendedoras",
  faixaEtaria: [28, 45],
  interesses: ["negócios", "rotina"],
  tom: "casual",
  ritmo: "rapido",
  idioma: "pt-BR",
  evitar: ["garantido", "fique rica"],
  ganchoMaxSeg: 4,
};

const script = {
  titulo: "Ep. 1",
  blocos: [
    { tipo: "gancho", texto: "Você está perdendo vendas.", duracaoSeg: 8 },
    {
      tipo: "desenvolvimento",
      texto: "O motivo é simples e garantido de resolver.",
      duracaoSeg: 25,
    },
    { tipo: "cta", texto: "Comenta QUERO.", duracaoSeg: 3 },
  ],
};

describe("validateAudienceProfile", () => {
  it("aceita perfil válido", () => {
    expect(validateAudienceProfile(profile).ok).toBe(true);
  });

  it("rejeita faixa etária invertida", () => {
    const r = validateAudienceProfile({ ...profile, faixaEtaria: [45, 28] });
    expect(r.ok).toBe(false);
  });

  it("rejeita tom desconhecido", () => {
    const r = validateAudienceProfile({ ...profile, tom: "misterioso" });
    expect(r.ok).toBe(false);
  });
});

describe("listAdaptationRules", () => {
  it("expõe regras auditáveis com id estável", () => {
    const rules = listAdaptationRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.map((r) => r.id)).toContain("gancho-curto");
    expect(rules.map((r) => r.id)).toContain("termos-a-evitar");
  });
});

describe("adaptScriptForAudience", () => {
  it("limita o gancho ao máximo do público", () => {
    const r = adaptScriptForAudience(script, profile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const gancho = r.value.scriptAdaptado.blocos[0];
      expect(gancho.duracaoSeg).toBe(4);
      expect(r.value.regrasAplicadas).toContain("gancho-curto");
      const ajuste = r.value.ajustes.find((a) => a.blocoIndex === 0);
      expect(ajuste?.antes).toBe(8);
      expect(ajuste?.depois).toBe(4);
    }
  });

  it("sinaliza bloco longo para ritmo rápido", () => {
    const r = adaptScriptForAudience(script, profile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.regrasAplicadas).toContain("ritmo-rapido");
      expect(r.value.avisos.some((a) => a.includes("25s"))).toBe(true);
    }
  });

  it("sinaliza termo da lista 'evitar' sem reescrever o texto", () => {
    const r = adaptScriptForAudience(script, profile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.regrasAplicadas).toContain("termos-a-evitar");
      expect(r.value.avisos.some((a) => a.includes("garantido"))).toBe(true);
      // texto original preservado — revisão humana decide
      expect(r.value.scriptAdaptado.blocos[1].texto).toContain("garantido");
    }
  });

  it("anota o tom esperado no CTA", () => {
    const r = adaptScriptForAudience(script, profile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.avisos.some((a) => a.includes("casual"))).toBe(true);
    }
  });

  it("não altera nada quando o roteiro já respeita o perfil", () => {
    const curto = {
      titulo: "Curto",
      blocos: [
        { tipo: "gancho", texto: "Olha isso.", duracaoSeg: 3 },
        { tipo: "desenvolvimento", texto: "Detalhe.", duracaoSeg: 10 },
        { tipo: "cta", texto: "Comenta.", duracaoSeg: 2 },
      ],
    };
    const r = adaptScriptForAudience(curto, { ...profile, evitar: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ajustes).toHaveLength(0);
      expect(r.value.scriptAdaptado.duracaoTotalSeg).toBe(15);
    }
  });

  it("falha com roteiro ou perfil inválidos", () => {
    expect(adaptScriptForAudience({ titulo: "x", blocos: [] }, profile).ok).toBe(
      false,
    );
    expect(adaptScriptForAudience(script, { ...profile, tom: "x" }).ok).toBe(
      false,
    );
  });
});
