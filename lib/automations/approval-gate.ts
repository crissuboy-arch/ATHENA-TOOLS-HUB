/**
 * Athena Tools Hub — portão de aprovação humana para automações (FASE 7).
 *
 * Conceito INEMA (degrau 3 — filas): "os fluxos param num portão antes do
 * que importa". No Hub esse portão JÁ EXISTE: o estado PENDING_APPROVAL da
 * máquina de jobs (lib/jobs/machine.ts) + a fila GET /api/v1/approvals.
 *
 * Este módulo NÃO duplica o fluxo — apenas declara, por tipo de automação,
 * se ela exige passar pelo portão antes de qualquer efeito externo, e
 * descreve como o job correspondente deve ser configurado. A decisão humana
 * continua sendo tomada na fila de approvals existente.
 */

import type { AutomationKind } from "./types";

/** Configuração do portão para um tipo de automação. */
export interface ApprovalGate {
  kind: AutomationKind;
  /** Se true, o job da automação deve ir para PENDING_APPROVAL. */
  requiresApproval: boolean;
  /** Motivo legível exibido a quem aprova. */
  motivo: string;
  /** Fila onde a decisão acontece (fluxo existente, não duplicado). */
  fila: "/api/v1/approvals";
  /** Scope necessário para decidir (fluxo existente). */
  scope: "approvals:decide";
}

const gates: Record<AutomationKind, Omit<ApprovalGate, "fila" | "scope">> = {
  reel_pipeline: {
    kind: "reel_pipeline",
    requiresApproval: true,
    motivo:
      "Pipeline de reel concluído na etapa de revisão — humano aprova antes de qualquer uso do material.",
  },
  audience_video: {
    kind: "audience_video",
    requiresApproval: true,
    motivo:
      "Roteiro adaptado por público — humano confere tom e avisos antes de produzir.",
  },
  trend_research: {
    kind: "trend_research",
    requiresApproval: false,
    motivo:
      "Pesquisa só agrega dados ingeridos; nenhum efeito externo. Aprovação exigida apenas ao USAR os resultados.",
  },
  content_prep: {
    kind: "content_prep",
    requiresApproval: false,
    motivo:
      "Geração de SRT/VTT é computação local reversível; aprovação ocorre no consumo (reel/relatório).",
  },
  campaign_report: {
    kind: "campaign_report",
    requiresApproval: true,
    motivo:
      "Relatório final só é publicado/compartilhado após conferência humana dos números.",
  },
  scheduled_publish: {
    kind: "scheduled_publish",
    requiresApproval: true,
    motivo:
      "Publicação é o efeito externo máximo — além do portão, está DESATIVADA até autorização explícita.",
  },
};

/** Retorna o portão de aprovação de um tipo de automação. */
export function approvalGateFor(kind: AutomationKind): ApprovalGate {
  const gate = gates[kind];
  return { ...gate, fila: "/api/v1/approvals", scope: "approvals:decide" };
}

/**
 * Texto de orientação para a UI/fila: o que o aprovador deve conferir.
 * A decisão em si acontece no fluxo existente de approvals.
 */
export function gateChecklist(kind: AutomationKind): string[] {
  const base = [
    "Conferir o veredito do checklist de fontes/métricas (source-verification).",
    "Confirmar que nenhum dado foi inventado — só números verificados.",
  ];
  const extras: Record<AutomationKind, string[]> = {
    reel_pipeline: ["Revisão da etapa 'revisao' marcada como aprovada."],
    audience_video: ["Avisos de termos da lista 'evitar' revisados."],
    trend_research: [],
    content_prep: [],
    campaign_report: ["Período do relatório confere com os dados agregados."],
    scheduled_publish: [
      "Publicação segue DESATIVADA — este portão não autoriza publicar.",
    ],
  };
  return [...base, ...extras[kind]];
}
