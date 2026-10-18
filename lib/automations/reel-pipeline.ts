/**
 * Athena Tools Hub — pipeline de reels em etapas (FASE 7).
 *
 * Conceito INEMA (degrau 4): o r7e "monta o reel em sete etapas de gatilho".
 * Aqui o pipeline é modelado como DADOS + VALIDADOR por etapa — cada etapa
 * produz uma estrutura validada, nunca vídeo real. A execução do pipeline
 * corre sobre a máquina de jobs existente (lib/jobs/machine.ts); este módulo
 * define o CONTEÚDO de cada etapa e as transições entre elas.
 *
 * Etapas: roteiro → cenas → legendas → montagem → revisao.
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";
import type { CaptionCue } from "./captions";

export const reelStages = [
  "roteiro",
  "cenas",
  "legendas",
  "montagem",
  "revisao",
] as const;
export type ReelStage = (typeof reelStages)[number];

export function isReelStage(value: unknown): value is ReelStage {
  return (
    typeof value === "string" &&
    (reelStages as readonly string[]).includes(value)
  );
}

/** Próxima etapa, ou null quando o pipeline terminou. */
export function nextStage(stage: ReelStage): ReelStage | null {
  const i = reelStages.indexOf(stage);
  return i >= 0 && i < reelStages.length - 1 ? reelStages[i + 1] : null;
}

/** Etapas que precisam estar concluídas antes de `stage`. */
export function previousStages(stage: ReelStage): readonly ReelStage[] {
  return reelStages.slice(0, reelStages.indexOf(stage));
}

/* ------------------------------ payloads ------------------------------ */

const roteiroSchema = z.object({
  hook: z.string().min(1, "hook do roteiro é obrigatório.").max(500),
  beats: z
    .array(z.string().min(1).max(500))
    .min(1, "roteiro precisa de ao menos 1 beat.")
    .max(20),
  cta: z.string().min(1, "CTA é obrigatório.").max(300),
  duracaoAlvoSeg: z.number().int().min(5).max(180),
});

const cenaSchema = z.object({
  descricao: z.string().min(1, "descrição da cena é obrigatória.").max(500),
  duracaoSeg: z.number().int().min(1).max(60),
  tipo: z.enum(["broll", "talking_head", "texto", "avatar"]),
});

const cenasSchema = z.object({
  cenas: z
    .array(cenaSchema)
    .min(1, "é necessária ao menos 1 cena.")
    .max(30, "máximo de 30 cenas."),
});

const cueSchema = z.object({
  inicioMs: z.number().int().min(0),
  fimMs: z.number().int().min(1),
  texto: z.string().min(1).max(120),
});

const legendasSchema = z.object({
  faixas: z
    .array(cueSchema)
    .min(1, "é necessária ao menos 1 faixa de legenda.")
    .max(500),
});

const montagemSchema = z.object({
  /** Ordem das cenas por índice (referencia o payload da etapa "cenas"). */
  ordemCenas: z.array(z.number().int().min(0)).min(1),
  transicoes: z
    .array(z.enum(["corte", "fade", "zoom"]))
    .max(30)
    .default([]),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  /** NOTA HONESTA: montagem aqui é a ESTRUTURA do plano de edição. */
  planoSomente: z.literal(true),
});

const revisaoSchema = z.object({
  checklist: z
    .array(z.string().min(1).max(200))
    .min(1, "revisão precisa de ao menos 1 item de checklist.")
    .max(30),
  aprovado: z.boolean(),
  notas: z.string().max(2000).default(""),
});

const stageSchemas: Record<ReelStage, z.ZodTypeAny> = {
  roteiro: roteiroSchema,
  cenas: cenasSchema,
  legendas: legendasSchema,
  montagem: montagemSchema,
  revisao: revisaoSchema,
};

export type RoteiroPayload = z.infer<typeof roteiroSchema>;
export type CenasPayload = z.infer<typeof cenasSchema>;
export type LegendasPayload = z.infer<typeof legendasSchema>;
export type MontagemPayload = z.infer<typeof montagemSchema>;
export type RevisaoPayload = z.infer<typeof revisaoSchema>;

/** Valida o payload de UMA etapa (puro). */
export function validateStagePayload(
  stage: ReelStage,
  payload: unknown,
): AutomationResult<unknown> {
  const parsed = stageSchemas[stage].safeParse(payload);
  if (!parsed.success) {
    return automationFail(
      "INVALID_STAGE_PAYLOAD",
      `Etapa "${stage}": ` +
        parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  return automationOk(parsed.data);
}

/* ------------------------------ pipeline ------------------------------ */

export interface StageRecord {
  stage: ReelStage;
  payload: unknown;
  validatedAt: string;
}

export interface ReelPipeline {
  id: string;
  titulo: string;
  /** Etapa atual (a próxima a ser preenchida/validada). */
  stage: ReelStage;
  stages: StageRecord[];
  /** true quando a etapa "revisao" foi aprovada. */
  concluido: boolean;
  criadoEm: string;
}

const pipelineInputSchema = z.object({
  id: z.string().min(1).max(120),
  titulo: z.string().min(1, "título do reel é obrigatório.").max(200),
  criadoEm: z.string().datetime({ offset: true }),
});

/** Cria um pipeline na etapa "roteiro" (puro). */
export function createPipeline(
  input: unknown,
): AutomationResult<ReelPipeline> {
  const parsed = pipelineInputSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_PIPELINE",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  return automationOk({
    ...parsed.data,
    stage: "roteiro",
    stages: [],
    concluido: false,
  });
}

/**
 * Avança o pipeline: valida o payload da etapa atual e move para a próxima.
 * A etapa "revisao" só conclui quando `aprovado: true` (portão humano).
 * Nunca executa renderização — produz apenas estruturas validadas.
 */
export function advancePipeline(
  pipeline: ReelPipeline,
  payload: unknown,
  validatedAt: string,
): AutomationResult<ReelPipeline> {
  if (pipeline.concluido) {
    return automationFail(
      "PIPELINE_DONE",
      "Pipeline já concluído — não há próxima etapa.",
    );
  }
  const check = validateStagePayload(pipeline.stage, payload);
  if (!check.ok) return check as AutomationResult<ReelPipeline>;

  // Regra extra da etapa legendas: faixas não podem sobrepor-se.
  if (pipeline.stage === "legendas") {
    const faixas = (check.value as LegendasPayload).faixas as CaptionCue[];
    for (let i = 1; i < faixas.length; i++) {
      if (faixas[i].inicioMs < faixas[i - 1].fimMs) {
        return automationFail(
          "OVERLAPPING_CUES",
          `Faixas de legenda sobrepostas na posição ${i}.`,
        );
      }
    }
  }

  // Portão humano: revisão reprovada não conclui.
  if (pipeline.stage === "revisao") {
    const revisao = check.value as RevisaoPayload;
    if (!revisao.aprovado) {
      return automationFail(
        "REVIEW_REJECTED",
        "Revisão reprovada pelo humano — pipeline volta para ajustes (permanece em revisao).",
      );
    }
  }

  const next = nextStage(pipeline.stage);
  const stages: StageRecord[] = [
    ...pipeline.stages,
    { stage: pipeline.stage, payload: check.value, validatedAt },
  ];
  return automationOk({
    ...pipeline,
    stages,
    stage: next ?? pipeline.stage,
    concluido: next === null,
  });
}

/** Payload validado de uma etapa já concluída, ou undefined. */
export function stagePayload<T>(
  pipeline: ReelPipeline,
  stage: ReelStage,
): T | undefined {
  return pipeline.stages.find((s) => s.stage === stage)?.payload as
    | T
    | undefined;
}
