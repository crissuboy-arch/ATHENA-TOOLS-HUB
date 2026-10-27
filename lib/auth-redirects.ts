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
 * Destino após o callback, tendo em conta o tipo de link que o
 * Supabase trocou. Uma sessão de recuperação (`redirectType`
 * "recovery", ou o evento PASSWORD_RECOVERY) vai SEMPRE para
 * `/reset-password` — mesmo quando o parâmetro `next` falta (caso
 * do fallback para o Site URL, que perde o `next` original). Sem
 * isto, a sessão de recuperação aterrava em `/login` e a pessoa
 * tentava entrar com a senha antiga, que é precisamente a que
 * esqueceu. Outros tipos seguem a allowlist de `next`.
 */
export function resolvePostCallbackDestination(
  next: string | null,
  redirectType: string | null | undefined,
): string {
  if (redirectType === "recovery") return "/reset-password";
  return resolveCallbackNext(next);
}

/**
 * Ação de resgate quando um link de autenticação aterra na raiz `/`
 * em vez do callback — acontece quando o Supabase ignora o
 * `redirectTo` (URL fora da allowlist) e volta para o Site URL
 * (origem nua). A landing é um componente de servidor sem cliente
 * Supabase: sem resgate, o código/fragmento perdia-se ao clicar
 * em "Entrar" e a pessoa ficava no login sem sessão.
 *
 * - Fragmento de recuperação (`#access_token…&type=recovery`) →
 *   "wait-session": esperar pela sessão e só então ir para
 *   `/reset-password` (nunca deitar fora o fragmento).
 * - `?code=` (PKCE) → "forward-callback": reencaminhar a query
 *   intacta para `/auth/callback`, que troca o código e encaminha
 *   por `redirectType` (recuperação → `/reset-password`).
 * - Qualquer outro caso (incluindo outras páginas) → null.
 */
export type RootRecoveryAction = "wait-session" | "forward-callback";

export function getRootRecoveryAction(
  pathname: string,
  search: string,
  hash: string,
): RootRecoveryAction | null {
  if (pathname !== "/") return null;
  if (isRecoveryHash(hash)) return "wait-session";
  const params = new URLSearchParams(search);
  if (params.get("code")) return "forward-callback";
  return null;
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
