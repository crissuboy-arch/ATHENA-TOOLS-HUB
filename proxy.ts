/**
 * Athena Tools Hub — proxy (Next.js 16: substitui o antigo middleware).
 *
 * - Sem Supabase configurado: libera tudo e marca `x-hub-setup: pending`
 *   (o shell exibe o estado de setup em vez de fingir autenticação).
 * - Com Supabase: rotas /app/* exigem cookie de sessão Supabase;
 *   sem ele, redireciona para /login.
 *
 * Nota: o proxy verifica APENAS a presença do cookie de sessão (barato).
 * A validação real do JWT acontece em lib/auth.ts dentro dos handlers.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  for (const { name } of request.cookies.getAll()) {
    // Cookies de auth do @supabase/ssr: sb-<project-ref>-auth-token[.0/.1]
    if (name.startsWith("sb-") && name.includes("-auth-token")) return true;
  }
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!SUPABASE_CONFIGURED) {
    const res = NextResponse.next();
    res.headers.set("x-hub-setup", "pending");
    return res;
  }

  // Rotas de app exigem sessão (este proxy só cobre /app/* via matcher).
  if (pathname.startsWith("/app") && !hasSupabaseSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
