import { NextResponse } from "next/server";

/**
 * GET /forgot-password — atalho para o formulário de recuperação.
 *
 * O formulário vive na tela de login (modo "forgot"); esta rota
 * existe para que o endereço /forgot-password seja real e
 * encaminhe para lá, sem duplicar o formulário noutra página.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login?mode=forgot", request.url));
}
