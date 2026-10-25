/**
 * Modo visualização temporário do Preview — TEMPORÁRIO, a remover
 * assim que a autenticação definitiva da proprietária estiver resolvida.
 *
 * O que faz: nos deployments Preview da Vercel, permite VER o painel
 * (interface + navegação) sem sessão do Hub, por trás da barreira de
 * login da própria Vercel (Deployment Protection) que já protege o
 * Preview. NÃO é um login: não há sessão, não há dados reais, não
 * há ações administrativas, não há chaves nem credenciais.
 *
 * O que NÃO muda: o código de autenticação, as rotas de API (que
 * continuam a responder 401 sem sessão), o RLS e as permissões do
 * Supabase, e Production. A contenção é dupla:
 *  1. Só ativa quando `VERCEL_ENV === "preview"` — variável definida
 *     pela própria Vercel. Em Production é "production" e em local é
 *     "development"/ausente: o modo fica OFF nos dois casos, mesmo
 *     que este código chegue a outra branch por engano.
 *  2. Vive apenas na branch `fix/login-melhorias` (Preview); nunca
 *     faz merge sem autorização explícita da proprietária.
 */
export function isPreviewViewMode(): boolean {
  return process.env.VERCEL_ENV === "preview";
}
