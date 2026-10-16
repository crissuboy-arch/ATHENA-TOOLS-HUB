/**
 * Athena Tools Hub — job service (persistência + transições auditadas).
 *
 * CONTRATO DE SCHEMA (alinhado às migrations em supabase/migrations/):
 *   execution_jobs(id uuid PK, org_id uuid, tool_id uuid NULL → tools.id,
 *        tool_slug text NULL, integration_id uuid NULL, idempotency_key text,
 *        state job_state, params jsonb, result jsonb NULL, error jsonb NULL,
 *        progress numeric, started_at/finished_at timestamptz NULL,
 *        created_by uuid, created_at/updated_at timestamptz,
 *        UNIQUE(org_id, idempotency_key))
 *   execution_events(id uuid PK, job_id uuid, org_id uuid, type text,
 *        message text NULL, payload jsonb, created_at timestamptz)
 *   audit_logs(id uuid PK, org_id uuid, actor_user_id uuid NULL,
 *        actor_type actor_type, action text, entity_type text NULL,
 *        entity_id text NULL, diff jsonb NULL, created_at timestamptz)
 *   generated_assets(id uuid PK, job_id uuid NULL, org_id uuid, kind text,
 *        name text, file_path text NULL, mime_type text NULL,
 *        size_bytes bigint NULL, metadata jsonb, created_by uuid NULL,
 *        created_at/updated_at timestamptz)
 *   tools(id uuid PK, org_id uuid, slug text UNIQUE por org, ...)
 *
 * Toda mudança de estado passa pela máquina de estados pura
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
  name: string;
  url: string;
  mimeType: string | null;
  sizeBytes: number | null;
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
  const toolSlug = String(row.tool_slug ?? "");
  const err = row.error as { message?: string } | null;
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    toolId: toolSlug,
    status: String(row.state) as JobStatus,
    params: (row.params as Record<string, unknown>) ?? {},
    idempotencyKey: String(row.idempotency_key),
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    errorMessage: err?.message ?? null,
    result: row.result ?? null,
    integrationStatus: integrationStatusFor(toolSlug),
  };
}

function toEventDTO(row: Record<string, unknown>): JobEventDTO {
  const payload = (row.payload as Record<string, unknown>) ?? {};
  return {
    id: String(row.id),
    type: String(row.type),
    fromStatus: (payload.from_state as string | null) ?? null,
    toStatus: (payload.to_state as string | null) ?? null,
    payload,
    actorId: String(payload.actor_id ?? ""),
    actorType: String(payload.actor_type ?? ""),
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
    message:
      input.fromStatus || input.toStatus
        ? `${input.fromStatus ?? "?"} → ${input.toStatus ?? "?"}`
        : null,
    // execution_events has no dedicated from/to/actor columns; they travel
    // inside payload so the timeline stays queryable without schema drift.
    payload: {
      ...(input.payload ?? {}),
      from_state: input.fromStatus ?? null,
      to_state: input.toStatus ?? null,
      actor_id: input.actor.id,
      actor_type: input.actor.type,
    },
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
    // actor_user_id is uuid: only real user ids go there; api_key/system
    // actors keep their id inside diff so nothing is lost.
    actor_user_id: input.actor.type === "user" ? input.actor.id : null,
    actor_type: input.actor.type,
    action: input.action,
    entity_type: input.resourceType,
    entity_id: input.resourceId,
    diff: {
      ...(input.detail ?? {}),
      actor_id: input.actor.id,
    },
  });
  if (error) {
    throw new HubError("INTERNAL", "Falha ao registrar auditoria.", 500);
  }
}

async function loadJobRow(jobId: string, orgId: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("execution_jobs")
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
    .from("execution_jobs")
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

  // Resolve o slug da tool para o uuid (tools.slug é único por org).
  // Tool desconhecida (ex.: ainda só no catálogo local): tool_id fica NULL,
  // tool_slug preserva a intenção — estado honesto, sem simulação.
  const { data: toolRow } = await supabase
    .from("tools")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("slug", input.toolId)
    .maybeSingle();
  const toolUuid = (toolRow as { id?: string } | null)?.id ?? null;

  const { data: inserted, error: insertError } = await supabase
    .from("execution_jobs")
    .insert({
      org_id: input.orgId,
      tool_id: toolUuid,
      tool_slug: input.toolId,
      params: input.params,
      state: "CREATED",
      idempotency_key: input.idempotencyKey,
      created_by: actor.type === "user" ? actor.id : null,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    // Corrida de idempotência: outra requisição inseriu primeiro.
    if (insertError?.code === "23505") {
      const retry = await supabase
        .from("execution_jobs")
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
  const from = String(row.state) as JobStatus;

  if (!allStates.includes(to)) {
    throw HubError.validation(`Status desconhecido: ${to}.`);
  }
  if (!canTransition(from, to)) {
    throw HubError.invalidTransition(from, to);
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("execution_jobs")
    .update({
      state: to,
      updated_at: new Date().toISOString(),
      ...(opts.errorMessage !== undefined
        ? { error: { message: opts.errorMessage } }
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
  const status = String(row.state) as JobStatus;
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
    .from("execution_jobs")
    .select("*", { count: "exact" })
    .eq("org_id", filter.orgId);
  if (filter.status) query = query.eq("state", filter.status);
  if (filter.toolId) query = query.eq("tool_slug", filter.toolId);

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
    .from("generated_assets")
    .select("*")
    .eq("job_id", jobId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new HubError("INTERNAL", "Falha ao listar assets.", 500);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      url: String(row.file_path ?? ""),
      mimeType: (row.mime_type as string | null) ?? null,
      sizeBytes:
        row.size_bytes === null || row.size_bytes === undefined
          ? null
          : Number(row.size_bytes),
      metadata: row.metadata ?? null,
      createdAt: String(row.created_at),
    };
  });
}
