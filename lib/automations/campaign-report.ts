/**
 * Athena Tools Hub — histórico e resultados de campanha (FASE 7).
 *
 * Conceito INEMA: fechar o ciclo — o que foi produzido, com que números
 * (verificados) e o que fica de histórico. O relatório é uma ESTRUTURA DE
 * DADOS agregada a partir dos outputs das outras automações; "final" exige
 * que todas as métricas venham de checklists de verificação aprovados.
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationKind,
  type AutomationResult,
  type AutomationStatus,
} from "./types";
import { verdict, type SourceChecklist } from "./source-verification";

/** Resumo de uma automação dentro da campanha. */
export interface AutomationSummary {
  kind: AutomationKind;
  titulo: string;
  status: AutomationStatus;
  /** Métricas já verificadas (nunca inventadas). */
  metricas?: Record<string, number>;
  /** Checklist de verificação que sustenta as métricas, se houver. */
  checklist?: SourceChecklist;
}

export interface CampaignPeriod {
  inicio: string;
  fim: string;
}

/** Relatório de campanha: histórico + resultados. */
export interface CampaignReport {
  id: string;
  titulo: string;
  periodo: CampaignPeriod;
  automations: AutomationSummary[];
  totais: Record<string, number>;
  destaques: string[];
  geradoEm: string;
  status: "rascunho" | "final";
}

const summarySchema = z.object({
  kind: z.enum([
    "reel_pipeline",
    "audience_video",
    "trend_research",
    "content_prep",
    "campaign_report",
    "scheduled_publish",
  ]),
  titulo: z.string().min(1).max(200),
  status: z.enum(["draft", "ready", "needs_approval", "blocked", "disabled"]),
  metricas: z.record(z.string(), z.number().min(0)).optional(),
});

const reportInputSchema = z
  .object({
    id: z.string().min(1).max(120),
    titulo: z.string().min(1, "título da campanha é obrigatório.").max(200),
    periodo: z.object({
      inicio: z.string().datetime({ offset: true }),
      fim: z.string().datetime({ offset: true }),
    }),
    automations: z
      .array(summarySchema)
      .min(1, "relatório precisa de ao menos 1 automação.")
      .max(100),
    destaques: z.array(z.string().min(1).max(500)).max(20).default([]),
    geradoEm: z.string().datetime({ offset: true }),
  })
  .refine((r) => new Date(r.periodo.fim) >= new Date(r.periodo.inicio), {
    message: "período: fim deve ser ≥ inicio.",
  });

/**
 * Constrói o rascunho do relatório agregando os resumos.
 * Puro — não busca dados em nenhum lugar; recebe os resumos prontos.
 */
export function buildReport(input: unknown): AutomationResult<CampaignReport> {
  const parsed = reportInputSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_REPORT",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const { id, titulo, periodo, automations, destaques, geradoEm } = parsed.data;
  const totais: Record<string, number> = {};
  for (const a of automations) {
    for (const [k, v] of Object.entries(a.metricas ?? {})) {
      totais[k] = (totais[k] ?? 0) + v;
    }
  }
  return automationOk({
    id,
    titulo,
    periodo,
    automations: automations as AutomationSummary[],
    totais,
    destaques,
    geradoEm,
    status: "rascunho",
  });
}

/**
 * Finaliza o relatório. Exige: (1) nenhuma automação em "draft"/"blocked";
 * (2) toda automação COM métricas precisa de checklist com veredito
 * "aprovado" — número sem fonte verificada não entra no final.
 */
export function finalizeReport(
  report: CampaignReport,
  checklists: SourceChecklist[],
): AutomationResult<CampaignReport> {
  if (report.status === "final") {
    return automationFail("ALREADY_FINAL", "Relatório já está final.");
  }
  const pendentes = report.automations.filter(
    (a) => a.status === "draft" || a.status === "blocked",
  );
  if (pendentes.length > 0) {
    return automationFail(
      "PENDING_AUTOMATIONS",
      `Há ${pendentes.length} automação(ões) em rascunho/bloqueada: ` +
        pendentes.map((a) => a.titulo).join("; "),
    );
  }
  const byAlvo = new Map(checklists.map((c) => [c.alvoId, c]));
  for (const a of report.automations) {
    if (a.metricas && Object.keys(a.metricas).length > 0) {
      const checklist = byAlvo.get(`${report.id}:${a.kind}`);
      if (!checklist) {
        return automationFail(
          "MISSING_VERIFICATION",
          `Automação "${a.titulo}" tem métricas mas nenhum checklist de verificação.`,
        );
      }
      const v = verdict(checklist);
      if (v.veredito !== "aprovado") {
        return automationFail(
          "UNVERIFIED_METRICS",
          `Automação "${a.titulo}": checklist "${v.veredito}" — métricas não verificadas não entram no relatório final.`,
        );
      }
    }
  }
  return automationOk({ ...report, status: "final" });
}

/** Linha legível do relatório (para UI/logs — sem expor dados sensíveis). */
export function reportLine(report: CampaignReport): string {
  const metricas = Object.entries(report.totais)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return (
    `${report.titulo} (${report.periodo.inicio.slice(0, 10)} → ` +
    `${report.periodo.fim.slice(0, 10)}) — ${report.automations.length} ` +
    `automação(ões), status ${report.status}` +
    (metricas ? ` — ${metricas}` : "")
  );
}
