/**
 * Athena Tools Hub — automações FASE 7 (conceitos INEMA como dados + validadores).
 *
 * r7e → reel-pipeline · promoavatar → audience-profiles ·
 * xviral → research + source-verification · degrau 2 → agent-profile ·
 * degrau 3 (portões) → approval-gate (reutiliza o fluxo existente).
 */

export * from "./types";
export * from "./agent-profile";
export * from "./reel-pipeline";
export * from "./captions";
export * from "./audience-profiles";
export * from "./research";
export * from "./source-verification";
export * from "./approval-gate";
export * from "./publish-schedule";
export * from "./campaign-report";

import type { AutomationCapability } from "./types";

/**
 * Catálogo honesto das capacidades de automação.
 * executionReady: false em tudo que exigiria executor externo real —
 * o Hub hoje planeia/valida estruturas; não executa vídeo, coleta ao
 * vivo, avatar ou publicação.
 */
export const automationCatalog: AutomationCapability[] = [
  {
    kind: "reel_pipeline",
    name: "Pipeline de reels em etapas",
    inemaReference: "r7e",
    description:
      "Roteiro → cenas → legendas → montagem → revisão. Cada etapa é uma estrutura de dados validada; a montagem é o plano de edição, não renderização.",
    executionReady: false,
    requiresApproval: true,
  },
  {
    kind: "audience_video",
    name: "Vídeo por perfil de público",
    inemaReference: "promoavatar",
    description:
      "Perfis de audiência tipados + regras declarativas de adaptação de roteiro (gancho, ritmo, termos a evitar). Não gera vídeo nem avatar.",
    executionReady: false,
    requiresApproval: true,
  },
  {
    kind: "trend_research",
    name: "Pesquisa de conteúdos e tendências",
    inemaReference: "xviral",
    description:
      "Job de pesquisa + ingestão validada de resultados + agregação por métrica. Coleta ao vivo não implementada — resultados entram por ingestão manual validada.",
    executionReady: false,
    requiresApproval: false,
  },
  {
    kind: "content_prep",
    name: "Preparação de legendas e roteiros",
    inemaReference: "xviral",
    description:
      "Geração e validação de SRT/VTT a partir de faixas, e estrutura de roteiro com blocos tipados. Computação pura — funcional de verdade.",
    executionReady: true,
    requiresApproval: false,
  },
  {
    kind: "campaign_report",
    name: "Histórico e resultados de campanha",
    inemaReference: "xviral",
    description:
      "Relatório agregado de campanha. 'Final' exige métricas sustentadas por checklists de verificação aprovados.",
    executionReady: true,
    requiresApproval: true,
  },
  {
    kind: "scheduled_publish",
    name: "Agendamento de publicação",
    inemaReference: "xviral",
    description:
      "DESATIVADO — stub tipado que recusa com PUBLICATION_DISABLED até autorização explícita da Cristiane.",
    executionReady: false,
    requiresApproval: true,
  },
];
