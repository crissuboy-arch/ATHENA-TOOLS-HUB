/**
 * Testes de lib/auth-redirects.ts — redirecionamentos do fluxo de
 * recuperação de senha. Puro, sem rede: o destino do link nunca pode
 * ser um URL arbitrário vindo de fora.
 */
import { describe, expect, it } from "vitest";
import {
  buildPasswordResetRedirect,
  isRecoveryHash,
  resolveCallbackNext,
} from "@/lib/auth-redirects";

describe("resolveCallbackNext", () => {
  it("aceita os destinos internos da allowlist", () => {
    expect(resolveCallbackNext("/reset-password")).toBe("/reset-password");
    expect(resolveCallbackNext("/")).toBe("/");
  });

  it("rejeita destinos externos e fora da allowlist", () => {
    expect(resolveCallbackNext(null)).toBe("/login");
    expect(resolveCallbackNext("")).toBe("/login");
    expect(resolveCallbackNext("https://evil.example")).toBe("/login");
    expect(resolveCallbackNext("//evil.example")).toBe("/login");
    expect(resolveCallbackNext("/settings")).toBe("/login");
    expect(resolveCallbackNext("/api/v1/tools")).toBe("/login");
  });
});

describe("buildPasswordResetRedirect", () => {
  it("constrói o callback a partir da origem, sem hardcode", () => {
    expect(
      buildPasswordResetRedirect(
        "https://athena-tools-2pzxfeiyz-crissuboy-9102s-projects.vercel.app",
      ),
    ).toBe(
      "https://athena-tools-2pzxfeiyz-crissuboy-9102s-projects.vercel.app/auth/callback?next=/reset-password",
    );
  });

  it("remove barras finais da origem", () => {
    expect(buildPasswordResetRedirect("https://preview.example/")).toBe(
      "https://preview.example/auth/callback?next=/reset-password",
    );
  });
});

describe("isRecoveryHash", () => {
  it("deteta o fragmento de recuperação do Supabase", () => {
    expect(
      isRecoveryHash("#access_token=abc&refresh_token=def&type=recovery"),
    ).toBe(true);
    expect(isRecoveryHash("access_token=abc&type=recovery")).toBe(true);
  });

  it("rejeita fragmentos que não são de recuperação", () => {
    expect(isRecoveryHash("")).toBe(false);
    expect(isRecoveryHash("#access_token=abc&type=signup")).toBe(false);
    expect(isRecoveryHash("#type=recovery")).toBe(false);
    expect(isRecoveryHash("#error=access_denied")).toBe(false);
  });
});
