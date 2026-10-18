/**
 * Athena Tools Hub — agendamento de publicação (FASE 7).
 *
 * Conceito INEMA (degrau 4): os xviral "publicam com a fonte na tela".
 *
 * ESTADO: DESATIVADO — por ordem explícita da Cristiane (2026-10-18),
 * publicação real está bloqueada até autorização dela, caso a caso.
 *
 * Este módulo é um STUB TIPADO: as estruturas de dados existem (para que o
 * resto do Hub possa planear), mas qualquer tentativa de agendar RECUSA com
 * erro claro. Nada aqui publica, agenda ou toca em API de rede social.
 */

import { z } from "zod";
import {
  automationFail,
  type AutomationError,
  type AutomationResult,
} from "./types";

/** Publicação segue desativada até autorização explícita da Cristiane. */
export const PUBLISHING_ENABLED = false;

export const PUBLICATION_DISABLED_MESSAGE =
  "Publicação desativada até autorização explícita da Cristiane (bloqueio de 2026-10-18).";

export const publicationChannels = [
  "instagram",
  "tiktok",
  "youtube_shorts",
] as const;
export type PublicationChannel = (typeof publicationChannels)[number];

/** Estrutura de um agendamento (planeamento — nunca executado). */
export interface ScheduledPublication {
  id: string;
  automationId: string;
  canal: PublicationChannel;
  /** ISO datetime futuro pretendido. */
  agendadoPara: string;
  legenda?: string;
  status: "planejado";
}

const scheduleInputSchema = z.object({
  id: z.string().min(1).max(120),
  automationId: z.string().min(1).max(120),
  canal: z.enum(publicationChannels),
  agendadoPara: z.string().datetime({ offset: true }),
  legenda: z.string().max(2200).optional(),
});

/** Valida apenas o FORMATO do pedido (para planeamento/rascunho). */
export function validateScheduleInput(
  input: unknown,
): AutomationResult<Omit<ScheduledPublication, "status">> {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_SCHEDULE",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  if (new Date(parsed.data.agendadoPara).getTime() <= Date.now()) {
    return automationFail(
      "SCHEDULE_IN_PAST",
      "agendadoPara precisa ser uma data futura.",
    );
  }
  return { ok: true, value: parsed.data };
}

function disabledError(): AutomationError {
  return {
    code: "PUBLICATION_DISABLED",
    message: PUBLICATION_DISABLED_MESSAGE,
  };
}

/**
 * Tenta agendar uma publicação — SEMPRE RECUSA enquanto desativado.
 * O stub existe para que chamadas acidentais falhem de forma explícita
 * em vez de silenciosa.
 */
export function schedulePublication(
  input: unknown,
): AutomationResult<ScheduledPublication> {
  void input; // stub desativado: o pedido é recusado sem inspeção
  return { ok: false, error: disabledError() };
}

/** Cancela um agendamento — também recusado (nada existe para cancelar). */
export function cancelScheduledPublication(
  id: string,
): AutomationResult<null> {
  void id; // stub desativado
  return { ok: false, error: disabledError() };
}

/** Lista agendamentos — recusado: não há executor de publicação. */
export function listScheduledPublications(): AutomationResult<
  ScheduledPublication[]
> {
  return { ok: false, error: disabledError() };
}
