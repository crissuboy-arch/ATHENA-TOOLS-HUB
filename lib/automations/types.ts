/**
 * Athena Tools Hub — tipos partilhados das automações (FASE 7).
 *
 * Conceito INEMA (degrau 4 — "redes no automático, com fonte na tela"):
 * r7e (pipeline de reels), promoavatar (vídeo por público) e xviral
 * (pesquisa de tendências com verificação de fontes/métricas) usam o
 * MESMO motor: só muda o tema. Aqui esse motor é modelado como dados +
 * validadores puros — nenhuma etapa executa renderização, publicação ou
 * chamada externa de verdade.
 *
 * Estado honesto: tudo o que é estrutural está marcado como tal; nada é
 * apresentado como operacional sem executor real conectado.
 */

/** Tipos de automação suportados pelo Hub (referência funcional INEMA). */
export type AutomationKind =
  | "reel_pipeline" // r7e — pipeline de reels em etapas
  | "audience_video" // promoavatar — vídeo adaptado por perfil de público
  | "trend_research" // xviral — pesquisa de conteúdos e tendências
  | "content_prep" // preparação de legendas e roteiros
  | "campaign_report" // histórico e resultados
  | "scheduled_publish"; // agendamento de publicação (DESATIVADO)

export const allAutomationKinds: readonly AutomationKind[] = [
  "reel_pipeline",
  "audience_video",
  "trend_research",
  "content_prep",
  "campaign_report",
  "scheduled_publish",
] as const;

/**
 * Estado honesto de uma automação.
 * "disabled" é reservado ao agendamento de publicação até autorização
 * explícita da Cristiane.
 */
export type AutomationStatus =
  | "draft"
  | "ready"
  | "needs_approval"
  | "blocked"
  | "disabled";

export function isAutomationKind(value: unknown): value is AutomationKind {
  return (
    typeof value === "string" &&
    (allAutomationKinds as readonly string[]).includes(value)
  );
}

export interface AutomationError {
  code: string;
  message: string;
}

/** Resultado puro: sucesso com valor, ou falha com erro tipado. */
export type AutomationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AutomationError };

export function automationOk<T>(value: T): AutomationResult<T> {
  return { ok: true, value };
}

export function automationFail<T>(
  code: string,
  message: string,
): AutomationResult<T> {
  return { ok: false, error: { code, message } };
}

/** Capacidade declarada de uma automação (catálogo honesto). */
export interface AutomationCapability {
  kind: AutomationKind;
  /** Nome legível. */
  name: string;
  /** Conceito INEMA de referência (funcional, não prova de código). */
  inemaReference: "r7e" | "promoavatar" | "xviral" | "degrau-2" | "degrau-3";
  description: string;
  /**
   * True somente quando há executor real conectado. Enquanto false,
   * a automação produz/planeia estruturas de dados — nunca executa.
   */
  executionReady: boolean;
  /** Exige aprovação humana (portão do degrau 3) antes de qualquer efeito. */
  requiresApproval: boolean;
}
