/**
 * Athena Tools Hub — pure job state machine.
 *
 * No I/O, no side effects: unit-testable. All status changes in the
 * platform MUST go through `canTransition` (enforced by lib/jobs/service.ts).
 *
 * States:
 *   CREATED          job registrado, ainda não validado
 *   VALIDATING       parâmetros sendo validados contra o contrato da tool
 *   PENDING_APPROVAL aguardando decisão humana (tools que exigem aprovação)
 *   QUEUED           aprovado/validado, aguardando executor
 *   RUNNING          executor ativo
 *   COMPLETED        resultado final disponível
 *   FAILED           falha definitiva (com motivo registrado em events)
 *   CANCELLED        cancelado por usuário ou por rejeição em aprovação
 *
 * FASE 3 (motor de execução): RUNNING → QUEUED existe exclusivamente para
 * recuperação de jobs órfãos (worker caiu sem heartbeat). Nunca é usada no
 * fluxo normal de execução.
 */

export type JobStatus =
  | "CREATED"
  | "VALIDATING"
  | "PENDING_APPROVAL"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const allStates: readonly JobStatus[] = [
  "CREATED",
  "VALIDATING",
  "PENDING_APPROVAL",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const terminalStates: readonly JobStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const cancellableStates: readonly JobStatus[] = [
  "CREATED",
  "VALIDATING",
  "PENDING_APPROVAL",
  "QUEUED",
  "RUNNING",
] as const;

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  CREATED: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["PENDING_APPROVAL", "QUEUED", "FAILED", "CANCELLED"],
  PENDING_APPROVAL: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "FAILED", "CANCELLED"],
  // FASE 3: recuperação de órfão — o worker caiu sem heartbeat e o job volta
  // à fila (ou vai para FAILED se o orçamento de retries esgotou). Ver
  // lib/jobs/heartbeat.ts (recoverStaleJobs). Não faz parte do fluxo normal.
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "QUEUED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** True when a transition from `from` to `to` is legal. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** All legal targets from a given state. */
export function nextStates(from: JobStatus): readonly JobStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(status: JobStatus): boolean {
  return (terminalStates as readonly string[]).includes(status);
}

/** Runtime guard: narrows an unknown string to JobStatus. */
export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === "string" && (allStates as readonly string[]).includes(value)
  );
}
