/**
 * Testes do modelo de erro de /api/v1 (lib/errors.ts):
 * cada código mapeia para o HTTP correto e o payload JSON nunca vaza stack.
 */
import { describe, expect, it } from "vitest";
import {
  errorPayload,
  errorStatus,
  HubError,
  newRequestId,
  type HubErrorCode,
} from "./errors";

describe("HubError — códigos mapeiam para o status HTTP correto", () => {
  const cases: Array<{ code: HubErrorCode; status: number }> = [
    { code: "SUPABASE_NOT_CONFIGURED", status: 503 },
    { code: "UNAUTHORIZED", status: 401 },
    { code: "FORBIDDEN", status: 403 },
    { code: "NOT_FOUND", status: 404 },
    { code: "VALIDATION", status: 400 },
    { code: "INVALID_TRANSITION", status: 409 },
    { code: "CONFLICT", status: 409 },
    { code: "NOT_IMPLEMENTED", status: 501 },
    { code: "RATE_LIMITED", status: 429 },
    { code: "REPLAY_DETECTED", status: 409 },
    { code: "INTERNAL", status: 500 },
  ];

  it.each(cases)("código $code → status $status", ({ code, status }) => {
    const err = new HubError(code, "mensagem", status);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(errorStatus(err)).toBe(status);
  });
});

describe("HubError factories", () => {
  it("notConfigured → 503 SUPABASE_NOT_CONFIGURED", () => {
    const err = HubError.notConfigured();
    expect(err.code).toBe("SUPABASE_NOT_CONFIGURED");
    expect(err.status).toBe(503);
  });
  it("unauthorized → 401, forbidden → 403, notFound → 404", () => {
    expect(HubError.unauthorized().status).toBe(401);
    expect(HubError.forbidden().status).toBe(403);
    expect(HubError.notFound().status).toBe(404);
  });
  it("validation → 400, invalidTransition → 409, conflict → 409", () => {
    expect(HubError.validation("x").status).toBe(400);
    expect(HubError.invalidTransition("A", "B").status).toBe(409);
    expect(HubError.conflict("x").status).toBe(409);
  });
  it("notImplemented → 501", () => {
    expect(HubError.notImplemented("x").status).toBe(501);
    expect(HubError.notImplemented("x").code).toBe("NOT_IMPLEMENTED");
  });
});

describe("errorPayload — forma { error: { code, message, requestId } }", () => {
  it("contém code, message e requestId", () => {
    const requestId = newRequestId();
    const body = errorPayload(HubError.notFound("Job"), requestId);
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Job não encontrado.", requestId },
    });
  });

  it("inclui detail quando definido, omite quando não", () => {
    const requestId = newRequestId();
    const withDetail = errorPayload(
      HubError.validation("inválido", { field: "orgId" }),
      requestId,
    );
    expect(withDetail.error.detail).toEqual({ field: "orgId" });
    expect(withDetail.error.code).toBe("VALIDATION");

    const noDetail = errorPayload(HubError.unauthorized(), requestId);
    expect("detail" in noDetail.error).toBe(false);
  });

  it("NUNCA vaza stack trace ou chaves internas", () => {
    const requestId = newRequestId();
    const body = errorPayload(HubError.notImplemented("executor em dev"), requestId);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("at ");
    expect(Object.keys(body.error)).toEqual(
      expect.arrayContaining(["code", "message", "requestId"]),
    );
  });

  it("erro desconhecido vira INTERNAL 500 com mensagem genérica", () => {
    const requestId = newRequestId();
    const original = new Error("segredo interno do servidor XYZ-123");
    const body = errorPayload(original, requestId);
    expect(body).toEqual({
      error: {
        code: "INTERNAL",
        message: "Erro interno. Tente novamente.",
        requestId,
      },
    });
    expect(JSON.stringify(body)).not.toContain("XYZ-123");
    expect(errorStatus(original)).toBe(500);
  });
});

describe("newRequestId", () => {
  it("gera UUIDs distintos", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
