/**
 * Athena Tools Hub — job service (persistência + transições auditadas).
 *
 * CONTRATO DE SCHEMA (para alinhamento com o agente de DB — tabelas esperadas):
 *   jobs(id uuid PK, org_id uuid, tool_id text, params jsonb, status text,
 *        idempotency_key text, created_by text, created_at timestamptz,
 *        updated_at timestamptz, error_message text NULL, result jsonb NULL,
 *        UNIQUE(org_id, idempotency_key))
 *   execution_events(id uuid PK, job_id uuid, org_id uuid, type text,
 *        from_status text NULL, to_status text NULL, payload jsonb,
 *        actor_id text, actor_type text, created_at timestamptz)
 *   audit_logs(id uuid PK, org_id uuid, actor_id text, actor_type text,
 *        action text, resource_type text, resource_id text, detail jsonb,
 *        created_at timestamptz)
 *   job_assets(id uuid PK, job_id uuid, org_id uuid, kind text, url text,
 *        metadata jsonb, created_at timestamptz)
 *   tools(id text PK — slug da tool, name text, description text,
 *        version text, status text, capabilities text[], updated_at timestamptz)
 *
 * Toda mudança de status passa pela máquina de estados pura
 * (lib/jobs/machine.ts) e gera linha em execution_events + audit_logs.
 *
 * HONESTIDADE: se nenhum adapter/executor estiver conectado para a tool,
 * o job é criado normalmente mas permanece em estado verdadeiro
 * (PENDING_APPROVAL ou QUEUED) e o GET expõe integrationStatus: 'pending'.
 * Nenhum sucesso de execução é simulado.
 */

import { HubError } from "../errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "../auth";
import { createJobSchema, parseOrThrow, type CreateJobInput, type Pagination } from "../validators";
import {
  allStates,
  canTransition,
  type JobStatus,
} from "./machine";
import { toolRegistry } from "../adapters/index";

export interface Actor {
  id: string;
  type: "user" | "api_key";
}

export type IntegrationStatus = "pending" | "ready";

export interface JobDTO {
  id: string;
  orgId: string;
  toolId: string;
  status: JobStatus;
  params: Record<string, unknown>;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  result: unknown;
  /** 'ready' só quando um executor real está conectado (adapter.executionReady). */
  integrationStatus: IntegrationStatus;
}

export interface JobEventDTO {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  payload: unknown;
  actorId: string;
  actorType: string;
  createdAt: string;
}

export interface JobAssetDTO {
  id: string;
  kind: string;
  url: string;
  metadata: unknown;
  createdAt: string;
}

function assertConfigured(): void {
  if (!isSupabaseConfigured()) throw HubError.notConfigured();
}

export function integrationStatusFor(toolId: string): IntegrationStatus {
  const adapter = toolRegistry.adapterFor(toolId);
  return adapter?.executionReady ? "ready" : "pending";
}

function toJobDTO(row: Record<string, unknown>): JobDTO {
  const toolId = String(row.tool_id);
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    toolId,
    status: String(row.status) as JobStatus,
    params: (row.params as Record<string, unknown>) ?? {},
    idempotencyKey: String(row.idempotency_key),
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    errorMessage: (row.error_message as string | null) ?? null,
    result: row.result ?? null,
    integrationStatus: integrationStatusFor(toolId),
  };
}

function toEventDTO(row: Record<string, unknown>): JobEventDTO {
  return {
    id: String(row.id),
    type: String(row.type),
    fromStatus: (row.from_status as string | null) ?? null,
    toStatus: (row.to_status as string | null) ?? null,
    payload: row.payload ?? null,
    actorId: String(row.actor_id ?? ""),
    actorType: String(row.actor_type ?? ""),
    createdAt: String(row.created_at),
  };
}

async function writeEvent(input: {
  jobId: string;
  orgId: string;
  type: string;
  fromStatus?: JobStatus | null;
  toStatus?: JobStatus | null;
  payload?: Record<string, unknown>;
  actor: Actor;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("execution_events").insert({
    job_id: input.jobId,
    org_id: input.orgId,
    type: input.type,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    payload: input.payload ?? {},
    actor_id: input.actor.id,
    actor_type: input.actor.type,
  });
  if (error) {
    throw new HubError("INTERNAL", "Falha ao registrar evento do job.", 500);
  }
}

async function writeAudit(input: {
  orgId: string;
  actor: Actor;
  action: string;
  resourceType: string;
  resourceId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("audit_logs").insert({
    org_id: input.orgId,
    actor_id: input.actor.id,
    actor_type: input.actor.type,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    detail: input.detail ?? {},
  });
  if (error) {
    throw new HubError("INTERNAL", "Falha ao registrar auditoria.", 500);
  }
}

async function loadJobRow(jobId: string, orgId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new HubError("INTERNAL", "Falha ao carregar o job.", 500);
  if (!data) throw HubError.notFound("Job");
  return data as Record<string, unknown>;
}

/**
 * Cria um job com idempotência (org + idempotencyKey).
 * Reenvio com a mesma chave retorna o job original, sem duplicar.
 */
export async function createJob(
  rawInput: unknown,
  actor: Actor,
): Promise<{ job: JobDTO; created: boolean }> {
  assertConfigured();
  const input: CreateJobInput = parseOrThrow(
    createJobSchema,
    rawInput,
    "Dados do job inválidos.",
  );
  const supabase = getSupabaseAdmin();

  const { data: existing, error: lookupError } = await supabase
    .from("jobs")
    .select("*")
    .eq("org_id", input.orgId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (lookupError) {
    throw new HubError("INTERNAL", "Falha ao verificar idempotência.", 500);
  }
  if (existing) {
    return { job: toJobDTO(existing as Record<string, unknown>), created: false };
  }

  // Validação contra o contrato da tool (quando há adapter registrado).
  const adapter = toolRegistry.adapterFor(input.toolId);
  if (adapter) {
    const validation = adapter.validateParams(input.params);
    if (!validation.ok) {
      throw HubError.validation(
        `Parâmetros inválidos para a tool "${input.toolId}".`,
        { errors: validation.errors },
      );
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("jobs")
    .insert({
      org_id: input.orgId,
      tool_id: input.toolId,
      params: input.params,
      status: "CREATED",
      idempotency_key: input.idempotencyKey,
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    // Corrida de idempotência: outra requisição inseriu primeiro.
    if (insertError?.code === "23505") {
      const retry = await supabase
        .from("jobs")
        .select("*")
        .eq("org_id", input.orgId)
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      if (!retry.error && retry.data) {
        return { job: toJobDTO(retry.data as Record<string, unknown>), created: false };
      }
    }
    throw new HubError("INTERNAL", "Falha ao criar o job.", 500);
  }

  const row = inserted as Record<string, unknown>;
  const jobId = String(row.id);

  await writeEvent({
    jobId,
    orgId: input.orgId,
    type: "job_created",
    payload: { toolId: input.toolId },
    actor,
  });

  // CREATED → VALIDATING (validação do contrato já feita acima).
  await applyTransition(jobId, input.orgId, "VALIDATING", actor, {
    note: "parâmetros validados contra o contrato da tool",
  });

  // Destino honesto: aprovação humana quando o contrato exige (ou tool
  // desconhecida — padrão seguro), senão fila para o executor.
  const requiresApproval = adapter ? adapter.dryRunInfo().requiresApproval : true;
  const target: JobStatus = requiresApproval ? "PENDING_APPROVAL" : "QUEUED";
  await applyTransition(jobId, input.orgId, target, actor, {
    note: requiresApproval
      ? "aguardando aprovação humana"
      : "aguardando executor",
  });

  await writeAudit({
    orgId: input.orgId,
    actor,
    action: "job.created",
    resourceType: "job",
    resourceId: jobId,
    detail: { toolId: input.toolId, status: target },
  });

  const finalRow = await loadJobRow(jobId, input.orgId);
  return { job: toJobDTO(finalRow), created: true };
}

/** Aplica uma transição validada pela máquina + evento + auditoria. */
export async function applyTransition(
  jobId: string,
  orgId: string,
  to: JobStatus,
  actor: Actor,
  opts: { note?: string; errorMessage?: string } = {},
): Promise<JobDTO> {
  assertConfigured();
  const row = await loadJobRow(jobId, orgId);
  const from = String(row.status) as JobStatus;

  if (!allStates.includes(to)) {
    throw HubError.validation(`Status desconhecido: ${to}.`);
  }
  if (!canTransition(from, to)) {
    throw HubError.invalidTransition(from, to);
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("jobs")
    .update({
      status: to,
      updated_at: new Date().toISOString(),
      ...(opts.errorMessage !== undefined
        ? { error_message: opts.errorMessage }
        : {}),
    })
    .eq("id", jobId)
    .eq("org_id", orgId);
  if (error) throw new HubError("INTERNAL", "Falha ao atualizar o job.", 500);

  await writeEvent({
    jobId,
    orgId,
    type: "status_transition",
    fromStatus: from,
    toStatus: to,
    payload: opts.note ? { note: opts.note } : {},
    actor,
  });
  await writeAudit({
    orgId,
    actor,
    action: "job.transition",
    resourceType: "job",
    resourceId: jobId,
    detail: { from, to, note: opts.note },
  });

  const updated = await loadJobRow(jobId, orgId);
  return toJobDTO(updated);
}

/** Atalho para transições externas (rotas). */
export async function transitionJob(
  jobId: string,
  orgId: string,
  to: JobStatus,
  actor: Actor,
  note?: string,
): Promise<JobDTO> {
  return applyTransition(jobId, orgId, to, actor, { note });
}

/** Cancela um job a partir de qualquer estado não-terminal. */
export async function cancelJob(
  jobId: string,
  orgId: string,
  actor: Actor,
  reason?: string,
): Promise<JobDTO> {
  return applyTransition(jobId, orgId, "CANCELLED", actor, {
    note: reason ?? "cancelado pelo usuário",
  });
}

/**
 * Decisão de aprovação humana. Só vale para PENDING_APPROVAL:
 * approve → QUEUED, reject → CANCELLED. Registra o aprovador.
 */
export async function decideApproval(
  jobId: string,
  orgId: string,
  decision: "approve" | "reject",
  justification: string,
  actor: Actor,
): Promise<JobDTO> {
  assertConfigured();
  const row = await loadJobRow(jobId, orgId);
  const status = String(row.status) as JobStatus;
  if (status !== "PENDING_APPROVAL") {
    throw HubError.invalidTransition(status, decision === "approve" ? "QUEUED" : "CANCELLED");
  }
  const target: JobStatus = decision === "approve" ? "QUEUED" : "CANCELLED";
  const job = await applyTransition(jobId, orgId, target, actor, {
    note: `${decision === "approve" ? "aprovado" : "rejeitado"}: ${justification}`,
  });
  await writeAudit({
    orgId,
    actor,
    action: decision === "approve" ? "approval.granted" : "approval.rejected",
    resourceType: "job",
    resourceId: jobId,
    detail: { justification },
  });
  return job;
}

export interface ListJobsFilter extends Pagination {
  orgId: string;
  status?: JobStatus;
  toolId?: string;
}

export async function listJobs(
  filter: ListJobsFilter,
): Promise<{ items: JobDTO[]; page: number; perPage: number; total: number }> {
  assertConfigured();
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("org_id", filter.orgId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.toolId) query = query.eq("tool_id", filter.toolId);

  const from = (filter.page - 1) * filter.perPage;
  const to = from + filter.perPage - 1;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new HubError("INTERNAL", "Falha ao listar jobs.", 500);
  return {
    items: (data ?? []).map((r) => toJobDTO(r as Record<string, unknown>)),
    page: filter.page,
    perPage: filter.perPage,
    total: count ?? 0,
  };
}

export async function getJob(jobId: string, orgId: string): Promise<JobDTO> {
  assertConfigured();
  return toJobDTO(await loadJobRow(jobId, orgId));
}

export async function getJobEvents(
  jobId: string,
  orgId: string,
): Promise<JobEventDTO[]> {
  assertConfigured();
  await loadJobRow(jobId, orgId); // garante escopo + existência
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("execution_events")
    .select("*")
    .eq("job_id", jobId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new HubError("INTERNAL", "Falha ao listar eventos.", 500);
  return (data ?? []).map((r) => toEventDTO(r as Record<string, unknown>));
}

export async function getJobAssets(
  jobId: string,
  orgId: string,
): Promise<JobAssetDTO[]> {
  assertConfigured();
  await loadJobRow(jobId, orgId);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("job_assets")
    .select("*")
    .eq("job_id", jobId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new HubError("INTERNAL", "Falha ao listar assets.", 500);
  return (data ?? []).map((r) => ({
    id: String((r as Record<string, unknown>).id),
    kind: String((r as Record<string, unknown>).kind),
    url: String((r as Record<string, unknown>).url),
    metadata: (r as Record<string, unknown>).metadata ?? null,
    createdAt: String((r as Record<string, unknown>).created_at),
  }));
}
