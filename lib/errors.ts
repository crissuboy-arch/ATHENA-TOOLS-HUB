/**
 * Athena Tools Hub — error model for /api/v1.
 *
 * Every API error responds with:
 *   { error: { code, message, requestId } }
 * Never leak secrets or stack traces. requestId is a uuid v4, also echoed
 * in the `x-request-id` response header for log correlation.
 */

export type HubErrorCode =
  | "SUPABASE_NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "NOT_IMPLEMENTED"
  | "RATE_LIMITED"
  | "REPLAY_DETECTED"
  | "INTERNAL";

export class HubError extends Error {
  readonly code: HubErrorCode;
  readonly status: number;
  /** Machine-readable detail (e.g. zod issues). Must never contain secrets. */
  readonly detail?: unknown;

  constructor(code: HubErrorCode, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "HubError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  static notConfigured(feature = "Supabase"): HubError {
    return new HubError(
      "SUPABASE_NOT_CONFIGURED",
      `${feature} não configurado. Defina as variáveis de ambiente do Supabase para habilitar este recurso.`,
      503,
    );
  }

  static unauthorized(message = "Autenticação necessária."): HubError {
    return new HubError("UNAUTHORIZED", message, 401);
  }

  static forbidden(message = "Acesso negado."): HubError {
    return new HubError("FORBIDDEN", message, 403);
  }

  static notFound(resource = "Recurso"): HubError {
    return new HubError("NOT_FOUND", `${resource} não encontrado.`, 404);
  }

  static validation(message: string, detail?: unknown): HubError {
    return new HubError("VALIDATION", message, 400, detail);
  }

  static invalidTransition(from: string, to: string): HubError {
    return new HubError(
      "INVALID_TRANSITION",
      `Transição de estado inválida: ${from} → ${to}.`,
      409,
    );
  }

  static conflict(message: string): HubError {
    return new HubError("CONFLICT", message, 409);
  }

  static notImplemented(message: string): HubError {
    return new HubError("NOT_IMPLEMENTED", message, 501);
  }
}

/** Build the standard JSON error payload. */
export function errorPayload(err: unknown, requestId: string): {
  error: { code: string; message: string; requestId: string; detail?: unknown };
} {
  if (err instanceof HubError) {
    const body: {
      error: { code: string; message: string; requestId: string; detail?: unknown };
    } = {
      error: { code: err.code, message: err.message, requestId },
    };
    if (err.detail !== undefined) body.error.detail = err.detail;
    return body;
  }
  return {
    error: { code: "INTERNAL", message: "Erro interno. Tente novamente.", requestId },
  };
}

/** HTTP status for any thrown error (defaults to 500). */
export function errorStatus(err: unknown): number {
  return err instanceof HubError ? err.status : 500;
}

/** New request correlation id. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
