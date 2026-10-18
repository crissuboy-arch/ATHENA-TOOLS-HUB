/**
 * Athena Tools Hub — FASE 8: acesso a missões (lado Hub).
 *
 * A missão é identificada pelo `mission_id` que a Athena gerou; no Hub
 * ele vive como `idempotency_key` do job (escopo: org_id). Este módulo
 * resolve a correlação missão↔job e monta o envelope de resposta.
 */

import { HubError } from "../errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "../auth";
import { getJob, getJobAssets, type JobDTO } from "../jobs/service";
import {
  type MissionInput,
  type MissionResponse,
  resolveRequiresApproval,
} from "./contract";
import { hubStatusToMissionStatus } from "./adapter";

/**
 * Localiza o job de uma missão pelo mission_id (idempotency_key) na org.
 * Retorna null quando não existe (o chamador decide o 404).
 */
export async function findJobByMissionId(
  missionId: string,
  orgId: string,
): Promise<JobDTO | null> {
  if (!isSupabaseConfigured()) throw HubError.notConfigured();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("execution_jobs")
    .select("id")
    .eq("org_id", orgId)
    .eq("idempotency_key", missionId)
    .maybeSingle();
  if (error) throw new HubError("INTERNAL", "Falha ao localizar a missão.", 500);
  if (!data) return null;
  return getJob((data as { id: string }).id, orgId);
}

/**
 * Monta o envelope de resposta da missão a partir do job.
 * `mission` (input original) só é necessário no POST; no GET os campos
 * derivados (requires_human_approval) vêm do estado do job.
 */
export async function buildMissionResponse(
  job: JobDTO,
  missionId: string,
  opts: {
    /** Input original da missão (POST). Define callback.accepted na resposta. */
    mission?: MissionInput;
    /** requires_human_approval resolvido no POST (para ecoar na resposta). */
    requiresHumanApproval?: boolean;
  } = {},
): Promise<MissionResponse> {
  const status = hubStatusToMissionStatus(job.status);
  const awaitingApproval = status === "AWAITING_APPROVAL";
  const requiresHumanApproval =
    opts.requiresHumanApproval ?? awaitingApproval;

  const assets =
    status === "SUCCEEDED" ? await getJobAssets(job.id, job.orgId) : null;

  return {
    mission_id: missionId,
    job_id: job.id,
    org_id: job.orgId,
    status,
    hub_status: job.status,
    requires_human_approval: requiresHumanApproval,
    awaiting_approval: awaitingApproval,
    approval: awaitingApproval
      ? {
          approval_id: job.id,
          decision_endpoint: `/api/v1/approvals/${job.id}/decision`,
          note: "Decisão humana via sistema de approvals existente (approve → QUEUED, reject → CANCELLED).",
        }
      : null,
    result: status === "SUCCEEDED" ? job.result : null,
    error_message: job.errorMessage,
    assets: assets
      ? assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          url: a.url,
          metadata: a.metadata,
        }))
      : null,
    integration_status: job.integrationStatus,
    callback: opts.mission?.callback
      ? { accepted: true, delivery: "not-implemented" }
      : null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

/** Atalho usado pelo POST: valida aprovação contra o contrato da tool. */
export function resolveMissionApproval(mission: MissionInput): boolean {
  return resolveRequiresApproval(
    mission.tool_id,
    mission.requires_human_approval,
  );
}
