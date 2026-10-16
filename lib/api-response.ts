/**
 * Athena Tools Hub — helpers de resposta para /api/v1.
 * Sucesso: JSON + `x-request-id`. Erro: { error: { code, message, requestId } }.
 */

import { errorPayload, errorStatus, HubError } from "./errors";

export interface ApiJsonOptions {
  requestId: string;
  status?: number;
  headers?: Record<string, string>;
}

/** Resposta JSON de sucesso com requestId no header. */
export function apiJson(
  data: unknown,
  { requestId, status = 200, headers = {} }: ApiJsonOptions,
): Response {
  return Response.json(data, {
    status,
    headers: { "x-request-id": requestId, ...headers },
  });
}

/** Resposta de erro padronizada (nunca vaza stack trace ou segredos). */
export function apiError(
  err: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  // Log server-side da causa real (sem expor ao cliente).
  if (!(err instanceof HubError)) {
    console.error(`[api][${requestId}]`, err);
  }
  return Response.json(errorPayload(err, requestId), {
    status: errorStatus(err),
    headers: { "x-request-id": requestId, ...extraHeaders },
  });
}
