/**
 * Athena Tools Hub — FASE 8: adaptador de vocabulário Hub ↔ Athena.
 *
 * O Hub fala em "jobs" com JobStatus (lib/jobs/machine.ts); a ATHENA
 * Control fala em "missions" com MissionStatus (lib/athena/contract.ts).
 * Este adaptador é o ÚNICO ponto de tradução entre os dois vocabulários.
 *
 * DIVERGÊNCIAS DOCUMENTADAS (nenhuma resolvida em silêncio):
 *
 * 1. VOCABULÁRIO DE ESTADOS — os nomes diferem de propósito:
 *      Hub CREATED          → Athena RECEIVED
 *      Hub COMPLETED        → Athena SUCCEEDED
 *      Hub PENDING_APPROVAL → Athena AWAITING_APPROVAL
 *    Os restantes (VALIDATING, QUEUED, RUNNING, FAILED, CANCELLED) são
 *    idênticos. A tradução é TOTAL e bijetiva: qualquer estado de um
 *    lado tem exatamente um correspondente do outro. Estado desconhecido
 *    → exceção explícita (nunca "mapeado para o mais próximo").
 *
 * 2. APROVAÇÃO HUMANA — o Hub decide via contrato da tool
 *    (adapter.dryRunInfo().requiresApproval; tool desconhecida = exige).
 *    A Athena pode pedir requires_human_approval, mas se divergir do
 *    contrato da tool a missão é REJEITADA com 409 CONFLICT
 *    (resolveRequiresApproval em contract.ts). O Hub nunca ignora nem
 *    inventa uma decisão de aprovação.
 *
 * 3. IDENTIDADE — mission_id (Athena) é preservado como idempotencyKey
 *    do job (escopo: org_id). O job_id interno do Hub é opaco para a
 *    Athena; a correlação missão↔job viaja sempre nos dois sentidos nas
 *    respostas.
 *
 * 4. RESULTADO — o Hub nunca simula resultado. SUCCEEDED só existe quando
 *    o job está COMPLETED com resultado real; enquanto o executor não
 *    está conectado (integrationStatus 'pending'), a missão fica em
 *    estado honesto (AWAITING_APPROVAL/QUEUED) e nunca "succeeds".
 *
 * 5. CALLBACKS — a Athena pode declarar callback.url, mas a entrega de
 *    webhooks NÃO está implementada no MVP (ver lib/athena/callback.ts).
 *    O caminho real é polling de GET /athena/missions/{id}.
 */

import { allStates, type JobStatus } from "../jobs/machine";
import {
  isMissionStatus,
  missionStatuses,
  type MissionStatus,
} from "./contract";

const HUB_TO_ATHENA: Record<JobStatus, MissionStatus> = {
  CREATED: "RECEIVED",
  VALIDATING: "VALIDATING",
  PENDING_APPROVAL: "AWAITING_APPROVAL",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  COMPLETED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const ATHENA_TO_HUB: Record<MissionStatus, JobStatus> = {
  RECEIVED: "CREATED",
  VALIDATING: "VALIDATING",
  AWAITING_APPROVAL: "PENDING_APPROVAL",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

/**
 * Traduz um estado interno do Hub para o vocabulário Athena.
 * Estado desconhecido → exceção (falha explícita, sem aproximação).
 */
export function hubStatusToMissionStatus(status: string): MissionStatus {
  const mapped = (HUB_TO_ATHENA as Record<string, MissionStatus>)[status];
  if (!mapped || !isMissionStatus(mapped)) {
    throw new Error(
      `[athena-adapter] estado do Hub sem mapeamento: ${JSON.stringify(status)}. ` +
        `A tradução Hub→Athena é total — isto indica divergência de contrato.`,
    );
  }
  return mapped;
}

/**
 * Tradução inversa (Athena → Hub). Usada por validações e logs.
 * Estado desconhecido → exceção.
 */
export function missionStatusToHubStatus(status: string): JobStatus {
  const mapped = (ATHENA_TO_HUB as Record<string, JobStatus>)[status];
  if (!mapped || !(allStates as readonly string[]).includes(mapped)) {
    throw new Error(
      `[athena-adapter] estado Athena sem mapeamento: ${JSON.stringify(status)}. ` +
        `A tradução Athena→Hub é total — isto indica divergência de contrato.`,
    );
  }
  return mapped;
}

/** Verificação de sanidade: o mapeamento cobre os 8 estados em ambos os sentidos. */
export function adapterCoverage(): {
  hubStates: number;
  missionStates: number;
  bijective: boolean;
} {
  const hubStates = Object.keys(HUB_TO_ATHENA).length;
  const missionStates = Object.keys(ATHENA_TO_HUB).length;
  const reverseOk = (missionStatuses as readonly string[]).every(
    (m) => HUB_TO_ATHENA[ATHENA_TO_HUB[m as MissionStatus]] === m,
  );
  return {
    hubStates,
    missionStates,
    bijective: hubStates === 8 && missionStates === 8 && reverseOk,
  };
}
