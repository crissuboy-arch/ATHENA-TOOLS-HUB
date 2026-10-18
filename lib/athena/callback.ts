/**
 * Athena Tools Hub — FASE 8: callback/polling de resultado da missão.
 *
 * ESTRUTURA DO CALLBACK (contrato para o lado Athena):
 *   - `MissionCallbackPayload`: o envelope que o Hub enviará por HTTPS POST
 *     para `callback.url` quando a missão atingir estado terminal.
 *   - `buildCallbackPayload`: constrói o envelope a partir do job + assets,
 *     sempre com `request_id` para correlação com os logs do Hub.
 *   - `deliverCallback`: ponto único de entrega.
 *
 * ESTADO HONESTO DO MVP:
 *   A entrega de webhooks NÃO está implementada (não há infraestrutura de
 *   fila/retry no MVP). `deliverCallback` lança HubError NOT_IMPLEMENTED
 *   (501) — explícito, nunca silencioso. A Athena DEVE fazer polling de
 *   GET /api/v1/athena/missions/{id} até estado terminal.
 *
 * POLÍTICA DE ENTREGA FUTURA (documentada aqui para o implementador):
 *   - Tentativas: até CALLBACK_MAX_ATTEMPTS (5), backoff exponencial
 *     2s → 4s → 8s → 16s → 32s (+jitter).
 *   - Timeout por tentativa: CALLBACK_TIMEOUT_MS (10s).
 *   - Assinatura HMAC-SHA256 do corpo com callback.secret no header
 *     X-Hub-Signature; segredo NUNCA vai para logs.
 *   - Falha definitiva após as tentativas → evento `callback_failed` em
 *     execution_events + linha em audit_logs (ação `callback.failed`).
 *   - Cada tentativa carrega `x-request-id` (o mesmo da missão) e o
 *     payload inclui `request_id` — rastreabilidade ponta a ponta.
 */

import { HubError, newRequestId } from "../errors";
import type { JobAssetDTO, JobDTO } from "../jobs/service";
import type { MissionStatus } from "./contract";
import { hubStatusToMissionStatus } from "./adapter";

export const CALLBACK_MAX_ATTEMPTS = 5;
export const CALLBACK_TIMEOUT_MS = 10_000;
export const CALLBACK_BACKOFF_BASE_MS = 2_000;

export type MissionCallbackEvent =
  | "mission.succeeded"
  | "mission.failed"
  | "mission.cancelled";

export interface MissionCallbackPayload {
  event: MissionCallbackEvent;
  mission_id: string;
  job_id: string;
  org_id: string;
  /** Estado no vocabulário Athena. */
  status: MissionStatus;
  /** Estado interno do Hub (debug). */
  hub_status: string;
  result: unknown;
  error_message: string | null;
  assets: Array<{
    id: string;
    kind: string;
    url: string;
    metadata: unknown;
  }>;
  /** Correlação com os logs server-side do Hub. */
  request_id: string;
  occurred_at: string;
}

function callbackEventFor(status: MissionStatus): MissionCallbackEvent {
  switch (status) {
    case "SUCCEEDED":
      return "mission.succeeded";
    case "FAILED":
      return "mission.failed";
    case "CANCELLED":
      return "mission.cancelled";
    default:
      throw new Error(
        `[athena-callback] callback só é emitido em estado terminal; recebido: ${status}.`,
      );
  }
}

/**
 * Constrói o envelope de callback. `missionId` é o idempotencyKey do job
 * (a identidade da missão no lado Athena). `requestId`: se omitido, um
 * novo é gerado — em produção deve ser o x-request-id da requisição que
 * originou a entrega, para rastreabilidade.
 */
export function buildCallbackPayload(
  job: JobDTO,
  missionId: string,
  assets: JobAssetDTO[],
  requestId: string = newRequestId(),
): MissionCallbackPayload {
  const status = hubStatusToMissionStatus(job.status);
  return {
    event: callbackEventFor(status),
    mission_id: missionId,
    job_id: job.id,
    org_id: job.orgId,
    status,
    hub_status: job.status,
    result: job.result,
    error_message: job.errorMessage,
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.url,
      metadata: a.metadata,
    })),
    request_id: requestId,
    occurred_at: new Date().toISOString(),
  };
}

/**
 * Ponto único de entrega do callback. MVP: NÃO IMPLEMENTADO.
 * Lança 501 NOT_IMPLEMENTED de forma explícita — a Athena não deve
 * assumir entrega; o caminho suportado é polling.
 *
 * O log inclui o request_id para correlação futura; nenhum segredo
 * (callback.secret) é registrado.
 */
export async function deliverCallback(
  _callbackUrl: string,
  payload: MissionCallbackPayload,
): Promise<never> {
  console.info(
    `[athena-callback][${payload.request_id}] entrega NÃO implementada no MVP ` +
      `(evento=${payload.event} mission_id=${payload.mission_id}); ` +
      `a Athena deve fazer polling de GET /api/v1/athena/missions/${payload.mission_id}.`,
  );
  throw HubError.notImplemented(
    "Entrega de callbacks (webhooks) não implementada no MVP. " +
      "Faça polling de GET /api/v1/athena/missions/{mission_id} até estado terminal.",
  );
}
