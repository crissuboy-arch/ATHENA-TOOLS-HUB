/**
 * Testes de lib/auth-errors.ts — a distinção entre as causas de
 * falha de autenticação. Usa as mensagens reais do Supabase Auth,
 * incluindo as dos logs de 25/10/2026: "One-time token not found",
 * 400 invalid_credentials e 429 over_email_send_rate_limit.
 */
import { describe, expect, it } from "vitest";
import {
  classifyAuthError,
  classifyExchangeError,
  classifyHashError,
  parseHashError,
} from "@/lib/auth-errors";

describe("classifyAuthError", () => {
  it("credenciais inválidas (400) ficam genéricas", () => {
    expect(
      classifyAuthError({
        code: "invalid_credentials",
        message: "Invalid login credentials",
        status: 400,
      }),
    ).toBe("invalid-credentials");
  });

  it("conta por confirmar distingue-se das credenciais inválidas", () => {
    expect(
      classifyAuthError({
        code: "email_not_confirmed",
        message: "Email not confirmed",
        status: 400,
      }),
    ).toBe("email-not-confirmed");
  });

  it("limite de envio (429) distingue-se de tudo o resto", () => {
    expect(
      classifyAuthError({
        code: "over_email_send_rate_limit",
        message: "Email rate limit exceeded",
        status: 429,
      }),
    ).toBe("email-rate-limited");
    expect(classifyAuthError({ status: 429 })).toBe("email-rate-limited");
  });

  it("token de uso único não encontrado = link expirado ou já utilizado", () => {
    expect(
      classifyAuthError({ message: "One-time token not found" }),
    ).toBe("token-expired");
    expect(
      classifyAuthError({ code: "otp_expired", message: "Token expired" }),
    ).toBe("token-expired");
    expect(
      classifyAuthError({ message: "Token has expired or is invalid" }),
    ).toBe("token-expired");
  });

  it("erros desconhecidos ou ausentes ficam genéricos", () => {
    expect(classifyAuthError(null)).toBe("unknown");
    expect(classifyAuthError({ message: "Something else" })).toBe(
      "unknown",
    );
  });
});

describe("parseHashError / classifyHashError", () => {
  it("extrai o código de erro do fragmento de verificação falhada", () => {
    const parsed = parseHashError(
      "#error=access_denied&error_code=otp_expired&error_description=One-time+token+not+found",
    );
    expect(parsed?.code).toBe("otp_expired");
    expect(classifyHashError(parsed)).toBe("token-expired");
  });

  it("sem error no fragmento, não há erro para classificar", () => {
    expect(parseHashError("")).toBeNull();
    expect(parseHashError("#access_token=abc&type=recovery")).toBeNull();
    expect(classifyHashError(null)).toBe("unknown");
  });
});

describe("classifyExchangeError", () => {
  it("verificador PKCE em falta distingue-se do link inválido", () => {
    // Código real do @supabase/auth-js (AuthPKCECodeVerifierMissingError).
    expect(
      classifyExchangeError({
        code: "pkce_code_verifier_not_found",
        message: "PKCE code verifier not found",
        status: 400,
      }),
    ).toBe("browser-mismatch");
    expect(
      classifyExchangeError({
        name: "AuthPKCECodeVerifierMissingError",
        message: "PKCE code verifier not found",
        status: 400,
      }),
    ).toBe("browser-mismatch");
    expect(
      classifyExchangeError({
        message: "code verifier missing for PKCE exchange",
        status: 400,
      }),
    ).toBe("browser-mismatch");
  });

  it("outros erros da troca seguem a classificação geral", () => {
    expect(
      classifyExchangeError({
        code: "otp_expired",
        message: "Token has expired",
        status: 400,
      }),
    ).toBe("token-expired");
    expect(classifyExchangeError(null)).toBe("unknown");
    expect(
      classifyExchangeError({ message: "something else", status: 400 }),
    ).toBe("unknown");
  });
});
