/**
 * Classificação de erros do Supabase Auth para mensagens ao utilizador.
 *
 * Problema que isto resolve: a tela de login mapeava TODOS os erros
 * para "E-mail ou senha inválidos", o que escondia três causas
 * completamente diferentes — conta por confirmar, link expirado ou
 * já utilizado, e limite de envio de e-mails atingido. A
 * proprietária ficou sem saber por que não entrava, e pediu links
 * atrás de links até bater no rate limit.
 *
 * Segurança: a distinção é feita APENAS a partir do erro que o
 * Supabase já devolveu a quem submeteu o formulário — nunca se
 * revela se um e-mail existe ou não a quem não o souber. O
 * formulário de recuperação continua a responder sempre com a
 * mensagem genérica em caso de sucesso, exista a conta ou não.
 */

export type AuthErrorKind =
  | "invalid-credentials"
  | "email-not-confirmed"
  | "email-rate-limited"
  | "token-expired"
  | "browser-mismatch"
  | "unknown";

interface AuthErrorLike {
  code?: string | null;
  name?: string | null;
  message?: string | null;
  status?: number | null;
}

/**
 * Classifica um erro da troca do código PKCE por sessão. O caso
 * que importa distinguir: `pkce_code_verifier_not_found` — o
 * verificador PKCE vive nos cookies da origem onde o link foi
 * pedido (o @supabase/ssr guarda-o aí). Se o link aterrar noutra
 * origem (fallback do Supabase para o Site URL, fora da allowlist)
 * ou noutro navegador/aplicação (o caso típico no telemóvel:
 * pedir no Chrome e abrir no browser interno do Gmail), o
 * verificador não existe e a troca falha — mesmo com o link
 * válido e dentro do prazo. Mostrar "link inválido" nesse caso
 * esconde a causa real e leva a pedir links atrás de links.
 * Detetado pelo código, pelo nome da classe ou pela mensagem.
 */
export function classifyExchangeError(
  error: AuthErrorLike | null | undefined,
): AuthErrorKind {
  if (!error) return "unknown";
  const hay = `${error.code ?? ""} ${error.name ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (
    hay.includes("pkce_code_verifier_not_found") ||
    hay.includes("authpkcecodeverifiermissingerror") ||
    hay.includes("code verifier")
  ) {
    return "browser-mismatch";
  }
  return classifyAuthError(error);
}

/**
 * Classifica um erro devolvido pelo Supabase Auth (login, recuperação
 * ou troca de código). A ordem importa: rate limit primeiro (429),
 * depois conta por confirmar, depois token, e só no fim o genérico.
 */
export function classifyAuthError(
  error: AuthErrorLike | null | undefined,
): AuthErrorKind {
  if (!error) return "unknown";
  const hay = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (
    error.status === 429 ||
    hay.includes("over_email_send_rate_limit") ||
    hay.includes("rate limit") ||
    hay.includes("too many requests")
  ) {
    return "email-rate-limited";
  }
  if (
    hay.includes("email_not_confirmed") ||
    hay.includes("email not confirmed")
  ) {
    return "email-not-confirmed";
  }
  if (
    hay.includes("otp_expired") ||
    hay.includes("one-time token not found") ||
    hay.includes("token has expired") ||
    hay.includes("token not found") ||
    hay.includes("expired token")
  ) {
    return "token-expired";
  }
  if (
    hay.includes("invalid_credentials") ||
    hay.includes("invalid login credentials")
  ) {
    return "invalid-credentials";
  }
  return "unknown";
}

export interface HashError {
  code: string;
  description: string;
}

/**
 * Extrai um erro de verificação do fragmento da URL
 * (`#error=access_denied&error_code=otp_expired&...`), que é como
 * o Supabase devolve uma verificação falhada quando redireciona.
 * Sem `error` no fragmento, devolve null.
 */
export function parseHashError(hash: string): HashError | null {
  if (!hash) return null;
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const error = params.get("error");
  if (!error) return null;
  return {
    code: params.get("error_code") ?? error,
    description: params.get("error_description") ?? "",
  };
}

/** Classifica um erro vindo do fragmento da URL (verificação falhada). */
export function classifyHashError(
  hashError: HashError | null,
): AuthErrorKind {
  if (!hashError) return "unknown";
  return classifyAuthError({ code: hashError.code, message: hashError.description });
}
