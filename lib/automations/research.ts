/**
 * Athena Tools Hub — pesquisa de conteúdos e tendências (FASE 7).
 *
 * Conceito INEMA (degrau 4): os xviral "assistem ao que os maiores do nicho
 * publicaram". Aqui: ESTRUTURA de job de pesquisa + ingestão validada de
 * resultados + agregação. A COLETA AO VIVO não está implementada — resultados
 * entram por ingestão (dados fornecidos/validados) e cada número passa pela
 * verificação de fontes (source-verification.ts) antes de virar decisão.
 *
 * Estado honesto: job "concluido" aqui significa "resultados ingeridos e
 * agregados", nunca "coletados ao vivo de redes sociais".
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";

export const researchStatuses = [
  "rascunho",
  "pronto",
  "em_execucao",
  "concluido",
  "falhou",
] as const;
export type ResearchStatus = (typeof researchStatuses)[number];

/** Origem de um resultado. Só "manual" aceita ingestão hoje. */
export const researchSources = [
  "manual",
  "apify",
  "rss",
  "api_externa",
] as const;
export type ResearchSource = (typeof researchSources)[number];

/** Fontes com ingestão implementada (honesto: só entrada manual). */
export const ingestibleSources: readonly ResearchSource[] = ["manual"] as const;

/** Job de pesquisa: O QUE procurar, não a coleta em si. */
export interface ResearchJob {
  id: string;
  nicho: string;
  consulta: string;
  fontes: ResearchSource[];
  /** Janela de publicação em dias (ex.: 30 = último mês). */
  janelaDias: number;
  /** Mínimo de resultados para considerar a pesquisa útil. */
  minimoResultados: number;
  status: ResearchStatus;
  criadoEm: string;
}

const researchJobSchema = z.object({
  id: z.string().min(1).max(120),
  nicho: z.string().min(1, "nicho é obrigatório.").max(120),
  consulta: z.string().min(1, "consulta é obrigatória.").max(500),
  fontes: z
    .array(z.enum(researchSources))
    .min(1, "ao menos 1 fonte.")
    .max(4),
  janelaDias: z.number().int().min(1).max(365).default(30),
  minimoResultados: z.number().int().min(1).max(1000).default(10),
  status: z.enum(researchStatuses).default("rascunho"),
  criadoEm: z.string().datetime({ offset: true }),
});

/** Valida um job de pesquisa (puro). */
export function validateResearchJob(
  input: unknown,
): AutomationResult<ResearchJob> {
  const parsed = researchJobSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_RESEARCH_JOB",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const job = parsed.data;
  const naoIngeriveis = job.fontes.filter(
    (f) => !(ingestibleSources as readonly string[]).includes(f),
  );
  if (naoIngeriveis.length > 0) {
    return automationFail(
      "SOURCE_NOT_INGESTIBLE",
      `Fontes sem ingestão implementada: ${naoIngeriveis.join(", ")}. ` +
        `Hoje só é possível ingerir resultados "manual".`,
    );
  }
  return automationOk(job);
}

/** Métricas de um conteúdo observado. Todas opcionais — nem toda fonte expõe tudo. */
export interface ContentMetrics {
  visualizacoes?: number;
  curtidas?: number;
  comentarios?: number;
  compartilhamentos?: number;
  /** Seguidores do autor na data da coleta (para taxa relativa). */
  seguidoresAutor?: number;
}

/** Um conteúdo observado no nicho. */
export interface ResearchResult {
  id: string;
  jobId: string;
  fonte: ResearchSource;
  titulo: string;
  url: string;
  autor?: string;
  publicadoEm: string;
  metricas: ContentMetrics;
  coletadoEm: string;
}

const metricsSchema = z.object({
  visualizacoes: z.number().int().min(0).optional(),
  curtidas: z.number().int().min(0).optional(),
  comentarios: z.number().int().min(0).optional(),
  compartilhamentos: z.number().int().min(0).optional(),
  seguidoresAutor: z.number().int().min(0).optional(),
});

const researchResultSchema = z.object({
  id: z.string().min(1).max(120),
  jobId: z.string().min(1).max(120),
  fonte: z.enum(researchSources),
  titulo: z.string().min(1, "título é obrigatório.").max(300),
  url: z.string().url("url inválida.").max(2000),
  autor: z.string().max(200).optional(),
  publicadoEm: z.string().datetime({ offset: true }),
  metricas: metricsSchema.default({}),
  coletadoEm: z.string().datetime({ offset: true }),
});

/**
 * Ingere resultados (ex.: colados manualmente) validando cada um.
 * Falha se QUALQUER resultado for inválido — ingestão é tudo-ou-nada.
 */
export function ingestResults(
  job: ResearchJob,
  inputs: unknown[],
): AutomationResult<ResearchResult[]> {
  if (job.status !== "pronto" && job.status !== "em_execucao") {
    return automationFail(
      "JOB_NOT_READY",
      `Job "${job.id}" está "${job.status}" — ingestão exige "pronto" ou "em_execucao".`,
    );
  }
  const results: ResearchResult[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const parsed = researchResultSchema.safeParse(inputs[i]);
    if (!parsed.success) {
      return automationFail(
        "INVALID_RESULT",
        `Resultado ${i}: ` +
          parsed.error.issues.map((e) => e.message).join(" "),
      );
    }
    if (parsed.data.jobId !== job.id) {
      return automationFail(
        "RESULT_JOB_MISMATCH",
        `Resultado ${i} pertence ao job "${parsed.data.jobId}", esperado "${job.id}".`,
      );
    }
    results.push(parsed.data);
  }
  const ids = new Set(results.map((r) => r.id));
  if (ids.size !== results.length) {
    return automationFail("DUPLICATE_RESULTS", "Há resultados com id duplicado.");
  }
  return automationOk(results);
}

/* ------------------------------ agregação ------------------------------ */

export type MetricKey = keyof ContentMetrics;

export interface ResearchAggregation {
  total: number;
  porFonte: Record<string, number>;
  /** Top N por métrica (só resultados que TÊM a métrica participam). */
  top: Record<MetricKey, { id: string; titulo: string; valor: number }[]>;
  /** Soma por métrica (para "conferir cada número" no relatório). */
  somas: Record<MetricKey, number>;
  atingeMinimo: boolean;
}

const metricKeys: MetricKey[] = [
  "visualizacoes",
  "curtidas",
  "comentarios",
  "compartilhamentos",
  "seguidoresAutor",
];

/** Agrega resultados ingeridos (puro). */
export function aggregateResults(
  job: ResearchJob,
  results: ResearchResult[],
  topN = 5,
): ResearchAggregation {
  const porFonte: Record<string, number> = {};
  for (const r of results) {
    porFonte[r.fonte] = (porFonte[r.fonte] ?? 0) + 1;
  }
  const top = {} as ResearchAggregation["top"];
  const somas = {} as ResearchAggregation["somas"];
  for (const key of metricKeys) {
    const comMetrica = results.filter(
      (r) => typeof r.metricas[key] === "number",
    );
    top[key] = comMetrica
      .map((r) => ({
        id: r.id,
        titulo: r.titulo,
        valor: r.metricas[key] as number,
      }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, topN);
    somas[key] = comMetrica.reduce(
      (acc, r) => acc + (r.metricas[key] as number),
      0,
    );
  }
  return {
    total: results.length,
    porFonte,
    top,
    somas,
    atingeMinimo: results.length >= job.minimoResultados,
  };
}
