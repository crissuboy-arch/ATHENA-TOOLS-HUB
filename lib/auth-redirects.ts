/**
 * URLs de redirecionamento dos fluxos de autenticação por e-mail
 * (recuperação de senha do Supabase Auth).
 *
 * Regras:
 * - O destino do link de recuperação é sempre construído a partir da
 *   origem onde o utilizador clicou (`window.location.origin`), para
 *   funcionar em qualquer deployment Preview sem hardcode de domínio.
 * - O parâmetro `next` do callback só aceita destinos internos da
 *   allowlist — qualquer outro valor cai para `/login` (nunca se
 *   redireciona para um destino arbitrário vindo do link).
 */

/** Destinos internos aceites após o callback de autenticação. */
const ALLOWED_NEXT = new Set(["/reset-password", "/"]);

/**
 * Resolve o parâmetro `next` do callback para um destino seguro.
 * Valores ausentes, externos ou fora da allowlist → `/login`.
 */
export function resolveCallbackNext(next: string | null): string {
  if (!next) return "/login";
  if (!next.startsWith("/")) return "/login";
  if (next.startsWith("//")) return "/login";
  return ALLOWED_NEXT.has(next) ? next : "/login";
}

/**
 * URL para onde o link de recuperação de senha deve voltar:
 * o callback, que troca o código pela sessão e segue para
 * `/reset-password`. A origem vem do deployment onde o utilizador
 * está (Preview incluído) — nunca hardcode.
 */
export function buildPasswordResetRedirect(origin: string): string {
  const clean = origin.replace(/\/+$/, "");
  return `${clean}/auth/callback?next=/reset-password`;
}

/**
 * Deteta um link de recuperação do Supabase Auth que chegou ao
 * fragmento da URL (`#access_token=…&type=recovery`), em vez de
 * passar pelo callback. Acontece quando o Supabase ignora o
 * `redirectTo` (URL fora da allowlist) e volta para o Site URL:
 * nesse caso a sessão chega à página de login, e é ela que tem
 * de encaminhar para `/reset-password` — nunca deitar fora o
 * fragmento com um redirecionamento cego para o login.
 */
export function isRecoveryHash(hash: string): boolean {
  if (!hash) return false;
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  return (
    Boolean(params.get("access_token")) &&
    params.get("type") === "recovery"
  );
}
