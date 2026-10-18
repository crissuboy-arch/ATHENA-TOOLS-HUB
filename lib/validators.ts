/**
 * Athena Tools Hub — zod schemas shared by /api/v1 and the job service.
 * All user input is validated through these schemas before touching storage.
 */

import { z } from "zod";
import { HubError } from "./errors";

export const uuidSchema = z.uuid({ message: "Deve ser um UUID válido." });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const createJobSchema = z.object({
  orgId: uuidSchema,
  toolId: z.string().min(1, "toolId é obrigatório.").max(120),
  params: z.record(z.string(), z.unknown()),
  idempotencyKey: uuidSchema.describe(
    "Chave de idempotência gerada pelo cliente (UUID). Reenvios com a mesma chave retornam o job original.",
  ),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const jobQuerySchema = paginationSchema.extend({
  orgId: uuidSchema,
  status: z
    .enum([
      "CREATED",
      "VALIDATING",
      "PENDING_APPROVAL",
      "QUEUED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ])
    .optional(),
  toolId: z.string().min(1).max(120).optional(),
});
export type JobQuery = z.infer<typeof jobQuerySchema>;

export const jobDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"], {
    message: "decision deve ser 'approve' ou 'reject'.",
  }),
  justification: z
    .string()
    .min(1, "Justificativa é obrigatória.")
    .max(2000, "Justificativa deve ter no máximo 2000 caracteres."),
});
export type JobDecision = z.infer<typeof jobDecisionSchema>;

/**
 * FASE 1 — drift código↔schema corrigido (ver supabase/migrations/0001_core.sql):
 * - `type` usa os valores reais do enum `integration_type`
 *   ('mcp', 'cli', 'api', 'webhook', 'sdk') — "api_key" não existe no schema
 *   (a chave vive em `integrations.config.apiKeyHash`, ver lib/api-keys.ts).
 * - a tabela `integrations` NÃO tem coluna `status`; a coluna real é `state`
 *   (enum `tool_state`), com default 'cataloged' no banco.
 */
export const integrationConfigSchema = z.object({
  name: z.string().min(1, "name é obrigatório.").max(120),
  type: z.enum(["mcp", "cli", "api", "webhook", "sdk"], {
    message: "type deve ser um dos valores de integration_type: mcp, cli, api, webhook, sdk.",
  }),
  scopes: z
    .array(z.enum(["tools:read", "jobs:read", "jobs:write", "approvals:decide"]))
    .min(1, "Informe ao menos um scope."),
  state: z
    .enum([
      "cataloged",
      "needs-config",
      "in-development",
      "connected",
      "operational-tested",
      "error",
      "unavailable",
    ])
    .default("cataloged"),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

/** Parse helper that converts zod failures into HubError VALIDATION. */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  message = "Dados inválidos.",
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw HubError.validation(message, result.error.flatten());
  }
  return result.data;
}
