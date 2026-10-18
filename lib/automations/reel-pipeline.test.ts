/**
 * Testes: pipeline de reels em etapas (r7e).
 * `npx vitest run lib/automations/reel-pipeline.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  advancePipeline,
  createPipeline,
  isReelStage,
  nextStage,
  previousStages,
  reelStages,
  stagePayload,
  validateStagePayload,
  type ReelPipeline,
} from "./reel-pipeline";

const NOW = "2026-10-18T12:00:00+01:00";

const roteiro = {
  hook: "Você está perdendo vendas sem saber.",
  beats: ["problema", "virada", "prova"],
  cta: "Comenta QUERO que eu te mostro.",
  duracaoAlvoSeg: 30,
};

const cenas = {
  cenas: [
    { descricao: "B-roll escritório", duracaoSeg: 5, tipo: "broll" },
    { descricao: "Talking head", duracaoSeg: 10, tipo: "talking_head" },
  ],
};

const legendas = {
  faixas: [
    { inicioMs: 0, fimMs: 2000, texto: "Você está perdendo vendas." },
    { inicioMs: 2000, fimMs: 5000, texto: "Sem saber por quê." },
  ],
};

const montagem = {
  ordemCenas: [0, 1],
  transicoes: ["corte"],
  aspectRatio: "9:16",
  planoSomente: true,
};

const revisaoOk = {
  checklist: ["áudio limpo", "legenda sincronizada"],
  aprovado: true,
  notas: "",
};

function freshPipeline(): ReelPipeline {
  const r = createPipeline({
    id: "reel-1",
    titulo: "Ep. 1",
    criadoEm: NOW,
  });
  if (!r.ok) throw new Error("pipeline inválido no teste");
  return r.value;
}

describe("estágios", () => {
  it("expõe as 5 etapas em ordem", () => {
    expect(reelStages).toEqual([
      "roteiro",
      "cenas",
      "legendas",
      "montagem",
      "revisao",
    ]);
  });

  it("nextStage avança e termina em null", () => {
    expect(nextStage("roteiro")).toBe("cenas");
    expect(nextStage("montagem")).toBe("revisao");
    expect(nextStage("revisao")).toBeNull();
  });

  it("previousStages lista dependências", () => {
    expect(previousStages("legendas")).toEqual(["roteiro", "cenas"]);
    expect(previousStages("roteiro")).toEqual([]);
  });

  it("isReelStage valida o tipo", () => {
    expect(isReelStage("cenas")).toBe(true);
    expect(isReelStage("render")).toBe(false);
  });
});

describe("createPipeline", () => {
  it("cria na etapa roteiro, não concluído", () => {
    const p = freshPipeline();
    expect(p.stage).toBe("roteiro");
    expect(p.concluido).toBe(false);
    expect(p.stages).toHaveLength(0);
  });

  it("rejeita sem título", () => {
    const r = createPipeline({ id: "x", titulo: "", criadoEm: NOW });
    expect(r.ok).toBe(false);
  });
});

describe("advancePipeline", () => {
  it("percorre o fluxo feliz até concluir", () => {
    let p = freshPipeline();
    const steps: [unknown][] = [
      [roteiro],
      [cenas],
      [legendas],
      [montagem],
      [revisaoOk],
    ];
    const expected: string[] = ["cenas", "legendas", "montagem", "revisao", "revisao"];
    steps.forEach(([payload], i) => {
      const r = advancePipeline(p, payload, NOW);
      expect(r.ok).toBe(true);
      if (r.ok) {
        p = r.value;
        expect(p.stage).toBe(expected[i]);
      }
    });
    expect(p.concluido).toBe(true);
    expect(p.stages).toHaveLength(5);
  });

  it("rejeita payload inválido da etapa atual", () => {
    const p = freshPipeline();
    const r = advancePipeline(p, { hook: "" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STAGE_PAYLOAD");
  });

  it("rejeita legendas com faixas sobrepostas", () => {
    let p = freshPipeline();
    for (const payload of [roteiro, cenas]) {
      const r = advancePipeline(p, payload, NOW);
      if (r.ok) p = r.value;
    }
    const r = advancePipeline(
      p,
      {
        faixas: [
          { inicioMs: 0, fimMs: 3000, texto: "a" },
          { inicioMs: 2000, fimMs: 4000, texto: "b" },
        ],
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OVERLAPPING_CUES");
  });

  it("revisão reprovada não conclui (portão humano)", () => {
    let p = freshPipeline();
    for (const payload of [roteiro, cenas, legendas, montagem]) {
      const r = advancePipeline(p, payload, NOW);
      if (r.ok) p = r.value;
    }
    const r = advancePipeline(
      p,
      { ...revisaoOk, aprovado: false },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("REVIEW_REJECTED");
  });

  it("não avança pipeline concluído", () => {
    let p = freshPipeline();
    for (const payload of [roteiro, cenas, legendas, montagem, revisaoOk]) {
      const r = advancePipeline(p, payload, NOW);
      if (r.ok) p = r.value;
    }
    const r = advancePipeline(p, revisaoOk, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PIPELINE_DONE");
  });

  it("stagePayload recupera o payload validado", () => {
    let p = freshPipeline();
    const r = advancePipeline(p, roteiro, NOW);
    if (r.ok) p = r.value;
    const saved = stagePayload<{ hook: string }>(p, "roteiro");
    expect(saved?.hook).toBe(roteiro.hook);
    expect(stagePayload(p, "cenas")).toBeUndefined();
  });
});

describe("validateStagePayload", () => {
  it("montagem exige planoSomente: true (honestidade estrutural)", () => {
    const r = validateStagePayload("montagem", {
      ...montagem,
      planoSomente: false,
    });
    expect(r.ok).toBe(false);
  });
});
