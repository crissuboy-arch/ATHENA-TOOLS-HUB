/**
 * Athena Tools Hub — FASE 8: contrato ATHENA ↔ HUB (lado Hub).
 *
 * Este módulo define o envelope "mission" que a ATHENA Control envia para
 * o Hub, a validação do payload e a resolução do requisito de aprovação
 * humana. Puro (sem I/O) para ser totalmente testável.
 *
 * Contrato formal: docs/ATHENA_INTEGRATION.md + openapi.yaml.
 * Ponte completa + handoff para o Cláudio: docs/ATHENA_BRIDGE.md.
 *
 * REGRA DE HONESTIDADE: nenhuma divergência é resolvida com fallback
 * silencioso. Conflito de aprovação → 409 CONFLICT. Estado desconhecido
 * → exceção. Resultado nunca é inventado (ver lib/athena/callback.ts).
 */

import { z } from "zod";
import { HubError } from "../errors";
import { parseOrThrow, uuidSchema } from "../validators";
import { toolRegistry } from "../adapters/index";
import type { JobStatus } from "../jobs/machine";

/* ------------------------------------------------------------------ */
/* Vocabulário de estados da missão (lado Athena)                      */
/* ------------------------------------------------------------------ */

/**
 * Estados da missão no vocabulário ATHENA. Intencionalmente distintos dos
 * estados internos do Hub (ver lib/athena/adapter.ts para o mapeamento
 * total e a divergência documentada).
 */
export const missionStatuses = [
  "RECEIVED",
  "VALIDATING",
  "AWAITING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export type MissionStatus = (typeof missionStatuses)[number];

export const terminalMissionStatuses: readonly MissionStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export function isMissionStatus(value: unknown): value is MissionStatus {
  return (
    typeof value === "string" &&
    (missionStatuses as readonly string[]).includes(value)
  );
}

export function isTerminalMissionStatus(status: MissionStatus): boolean {
  return (terminalMissionStatuses as readonly string[]).includes(status);
}

/* ------------------------------------------------------------------ */
/* Payload da missão (Athena → Hub)                                    */
/* ------------------------------------------------------------------ */

export const callbackConfigSchema = z.object({
  url: z
    .url({ message: "callback.url deve ser uma URL válida." })
    .refine((u) => u.startsWith("https://"), {
      message: "callback.url deve usar HTTPS.",
    }),
  method: z.enum(["POST"]).default("POST"),
  /**
   * Segredo opcional para autenticação futura do callback (HMAC).
   * NÃO é persistido no MVP: a entrega de webhooks não está implementada
   * (ver lib/athena/callback.ts) e segredos nunca vão para o banco.
   * Se presente, é validado e explicitamente assinalado como não
   * armazenado na resposta.
   */
  secret: z.string().min(16).max(256).optional(),
});
export type MissionCallbackConfig = z.infer<typeof callbackConfigSchema>;

export const missionSchema = z.object({
  /** Identificador da missão no lado Athena. É PRESERVADO: vira a chave
   *  de idempotência do job no Hub (org_id, idempotency_key). */
  mission_id: uuidSchema.describe("UUID da missão (lado Athena)."),
  /** Slug da tool do catálogo (ex.: "vectorcraft"). */
  tool_id: z.string().min(1, "tool_id é obrigatório.").max(120),
  /** Opcional: deve ser a org da chave de API (divergência → 403). */
  org_id: uuidSchema.optional(),
  /** Parâmetros da tool (validados contra o contrato da tool no service). */
  params: z.record(z.string(), z.unknown()),
  /**
   * Exigência de aprovação humana vinda da Athena.
   * - true  → o job TEM de passar por PENDING_APPROVAL.
   * - false → o job NÃO passa por aprovação.
   * - omitido → decide o contrato da tool no Hub.
   * Se o valor pedido divergir do contrato da tool → 409 CONFLICT
   * (nunca é silenciosamente ajustado).
   */
  requires_human_approval: z.boolean().optional(),
  /** Configuração de callback de resultado (entrega NÃO implementada no MVP). */
  callback: callbackConfigSchema.optional(),
  priority: z.number().int().min(0).max(100).default(50),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Expiração da missão (ISO 8601). No passado → validação falha. */
  expires_at: z.iso
    .datetime({ message: "expires_at deve ser ISO 8601." })
    .refine((s) => new Date(s).getTime() > Date.now(), {
      message: "expires_at está no passado.",
    })
    .optional(),
});
export type MissionInput = z.infer<typeof missionSchema>;

export const missionIdParamSchema = z.object({
  id: uuidSchema,
});

/** Valida o payload da missão; lança HubError VALIDATION (400) se inválido. */
export function parseMission(data: unknown): MissionInput {
  return parseOrThrow(missionSchema, data, "Payload da missão inválido.");
}

/* ------------------------------------------------------------------ */
/* Aprovação humana                                                     */
/* ------------------------------------------------------------------ */

/**
 * O contrato da tool no Hub decide se aprovação humana é exigida.
 * Tool desconhecida (sem adapter registrado) → exige aprovação (padrão seguro).
 */
export function toolRequiresApproval(toolId: string): boolean {
  const adapter = toolRegistry.adapterFor(toolId);
  return adapter ? adapter.dryRunInfo().requiresApproval : true;
}

/**
 * Resolve o requisito final de aprovação humana.
 * Divergência explícita entre o pedido da Athena e o contrato da tool
 * → HubError CONFLICT (409). Sem fallback silencioso.
 */
export function resolveRequiresApproval(
  toolId: string,
  requested: boolean | undefined,
): boolean {
  const contract = toolRequiresApproval(toolId);
  if (requested === undefined) return contract;
  if (requested !== contract) {
    throw HubError.conflict(
      `requires_human_approval=${requested} diverge do contrato da tool "${toolId}" ` +
        `(contrato exige aprovação: ${contract}). Ajuste o pedido ou o contrato da tool — ` +
        `nenhum ajuste silencioso é aplicado.`,
    );
  }
  return contract;
}

/* ------------------------------------------------------------------ */
/* Missão → input do job service                                       */
/* ------------------------------------------------------------------ */

export interface MissionJobInput {
  orgId: string;
  toolId: string;
  params: Record<string, unknown>;
  /** mission_id preservado como chave de idempotência. */
  idempotencyKey: string;
}

/**
 * Converte a missão validada no input de `createJob` (lib/jobs/service.ts).
 * O mission_id é preservado verbatim como idempotencyKey: o mesmo
 * mission_id na mesma org SEMPRE resolve para o mesmo job.
 */
export function missionToJobInput(
  mission: MissionInput,
  orgId: string,
): MissionJobInput {
  return {
    orgId,
    toolId: mission.tool_id,
    params: mission.params,
    idempotencyKey: mission.mission_id,
  };
}

/* ------------------------------------------------------------------ */
/* Envelope de resposta da missão                                      */
/* ------------------------------------------------------------------ */

export interface MissionResponse {
  mission_id: string;
  job_id: string;
  org_id: string;
  /** Estado no vocabulário Athena (ver adapter.ts). */
  status: MissionStatus;
  /** Estado interno do Hub (transparência para debug). */
  hub_status: JobStatus;
  requires_human_approval: boolean;
  awaiting_approval: boolean;
  /** Ponto de aprovação quando awaiting_approval=true (usa o sistema existente). */
  approval: {
    approval_id: string;
    decision_endpoint: string;
    note: string;
  } | null;
  result: unknown;
  error_message: string | null;
  assets: Array<{
    id: string;
    kind: string;
    url: string;
    metadata: unknown;
  }> | null;
  integration_status: "pending" | "ready";
  callback: { accepted: boolean; delivery: "not-implemented" } | null;
  created_at: string;
  updated_at: string;
}
