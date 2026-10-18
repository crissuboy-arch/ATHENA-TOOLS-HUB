/**
 * Testes: pesquisa de tendências (job + ingestão + agregação).
 * `npx vitest run lib/automations/research.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  aggregateResults,
  ingestResults,
  validateResearchJob,
  type ResearchJob,
  type ResearchResult,
} from "./research";

const NOW = "2026-10-18T12:00:00+01:00";

const jobInput = {
  id: "job-viral-1",
  nicho: "marketing digital",
  consulta: "reels com mais salvamentos no nicho",
  fontes: ["manual"],
  janelaDias: 30,
  minimoResultados: 2,
  status: "pronto",
  criadoEm: NOW,
};

function validJob(): ResearchJob {
  const r = validateResearchJob(jobInput);
  if (!r.ok) throw new Error("job inválido no teste");
  return r.value;
}

const resultInput = (id: string, views: number) => ({
  id,
  jobId: "job-viral-1",
  fonte: "manual",
  titulo: `Reel ${id}`,
  url: `https://exemplo.com/${id}`,
  autor: "@canal",
  publicadoEm: "2026-10-10T10:00:00+01:00",
  metricas: { visualizacoes: views, curtidas: views / 10 },
  coletadoEm: NOW,
});

describe("validateResearchJob", () => {
  it("aceita job com fonte manual", () => {
    const r = validateResearchJob(jobInput);
    expect(r.ok).toBe(true);
  });

  it("rejeita fonte sem ingestão implementada (honestidade)", () => {
    const r = validateResearchJob({ ...jobInput, fontes: ["apify"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SOURCE_NOT_INGESTIBLE");
  });

  it("rejeita sem nicho", () => {
    const r = validateResearchJob({ ...jobInput, nicho: "" });
    expect(r.ok).toBe(false);
  });
});

describe("ingestResults", () => {
  it("ingere resultados válidos", () => {
    const r = ingestResults(validJob(), [
      resultInput("r1", 1000),
      resultInput("r2", 5000),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it("é tudo-ou-nada: um inválido falha a ingestão", () => {
    const r = ingestResults(validJob(), [
      resultInput("r1", 1000),
      { ...resultInput("r2", 5000), url: "não-url" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_RESULT");
  });

  it("rejeita resultado de outro job", () => {
    const r = ingestResults(validJob(), [
      { ...resultInput("r1", 1000), jobId: "outro-job" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("RESULT_JOB_MISMATCH");
  });

  it("rejeita ids duplicados", () => {
    const r = ingestResults(validJob(), [
      resultInput("r1", 1000),
      resultInput("r1", 2000),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("DUPLICATE_RESULTS");
  });

  it("só ingere com job pronto/em_execucao", () => {
    const rascunho = validateResearchJob({ ...jobInput, status: "rascunho" });
    expect(rascunho.ok).toBe(true);
    if (rascunho.ok) {
      const r = ingestResults(rascunho.value, [resultInput("r1", 1000)]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("JOB_NOT_READY");
    }
  });
});

describe("aggregateResults", () => {
  function results(): ResearchResult[] {
    const r = ingestResults(validJob(), [
      resultInput("r1", 1000),
      resultInput("r2", 5000),
      resultInput("r3", 3000),
    ]);
    if (!r.ok) throw new Error("ingestão falhou no teste");
    return r.value;
  }

  it("agrega totais, fontes e top por métrica", () => {
    const agg = aggregateResults(validJob(), results());
    expect(agg.total).toBe(3);
    expect(agg.porFonte).toEqual({ manual: 3 });
    expect(agg.top.visualizacoes[0].id).toBe("r2");
    expect(agg.somas.visualizacoes).toBe(9000);
    expect(agg.atingeMinimo).toBe(true);
  });

  it("atingeMinimo false quando abaixo do mínimo", () => {
    const agg = aggregateResults(validJob(), results().slice(0, 1));
    expect(agg.atingeMinimo).toBe(false);
  });

  it("top ignora resultados sem a métrica", () => {
    const semMetrica = {
      ...resultInput("r4", 0),
      metricas: {},
    };
    const r = ingestResults(validJob(), [...results().map((x) => ({ ...x })), semMetrica]);
    // r4 tem metricas {} — visualizacoes ausente
    const list = r.ok ? r.value : results();
    const agg = aggregateResults(validJob(), list);
    expect(agg.top.visualizacoes.every((t) => t.id !== "r4")).toBe(true);
  });
});
