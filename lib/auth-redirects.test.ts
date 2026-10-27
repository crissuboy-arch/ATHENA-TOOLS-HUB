/**
 * Testes de lib/auth-redirects.ts — redirecionamentos do fluxo de
 * recuperação de senha. Puro, sem rede: o destino do link nunca pode
 * ser um URL arbitrário vindo de fora.
 */
import { describe, expect, it } from "vitest";
import {
  buildPasswordResetRedirect,
  getRootRecoveryAction,
  isRecoveryHash,
  resolveCallbackNext,
  resolvePostCallbackDestination,
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

describe("resolvePostCallbackDestination", () => {
  it("recuperação vai sempre para /reset-password, mesmo sem next", () => {
    expect(resolvePostCallbackDestination(null, "recovery")).toBe(
      "/reset-password",
    );
    expect(resolvePostCallbackDestination("/login", "recovery")).toBe(
      "/reset-password",
    );
    // O caso do fallback para o Site URL: o next perdeu-se, mas a
    // sessão de recuperação não pode aterrar no login.
    expect(resolvePostCallbackDestination("/", "recovery")).toBe(
      "/reset-password",
    );
  });

  it("outros tipos seguem a allowlist de next", () => {
    expect(resolvePostCallbackDestination("/reset-password", null)).toBe(
      "/reset-password",
    );
    expect(resolvePostCallbackDestination("/reset-password", "signup")).toBe(
      "/reset-password",
    );
    expect(resolvePostCallbackDestination(null, undefined)).toBe("/login");
    expect(
      resolvePostCallbackDestination("https://evil.example", null),
    ).toBe("/login");
  });
});

describe("getRootRecoveryAction", () => {
  const hash =
    "#access_token=x&refresh_token=y&type=recovery";

  it("fragmento de recuperação na raiz espera pela sessão", () => {
    expect(getRootRecoveryAction("/", "", hash)).toBe("wait-session");
  });

  it("código PKCE na raiz reencaminha para o callback", () => {
    expect(getRootRecoveryAction("/", "code=abc&sb_flow_id=f1", "")).toBe(
      "forward-callback",
    );
  });

  it("não age fora da raiz nem sem indicadores", () => {
    expect(getRootRecoveryAction("/login", "", hash)).toBeNull();
    expect(getRootRecoveryAction("/catalog", "code=abc", "")).toBeNull();
    expect(getRootRecoveryAction("/", "", "")).toBeNull();
    expect(getRootRecoveryAction("/", "next=/reset-password", "")).toBeNull();
    expect(getRootRecoveryAction("/", "", "#error=access_denied")).toBeNull();
  });
});
