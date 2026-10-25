import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { PreviewViewBanner } from "@/components/layout/PreviewViewBanner";
import { AuthRedirectRegistrar } from "@/components/auth-redirect";
import { isPreviewViewMode } from "@/lib/preview-view-mode";
import { t } from "@/lib/i18n";

/**
 * Next.js 16 (cacheComponents): este layout faz checagem de sessão via
 * cookies() no request, portanto NÃO pode ser prerenderado — opt-out
 * explícito de navegação instantânea (rota "blocking").
 */
export const instant = false;

interface SessionUser {
  email: string | null;
}

/**
 * Session check via the DB agent's `@/lib/supabase` module.
 * The specifier is intentionally non-literal so this file compiles and runs
 * before that module exists: missing module => no session => redirect to
 * /login (which renders the honest "setup required" state).
 */
async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const specifier = "@/lib/supabase";
    const mod = await import(specifier);
    const factory = mod?.createServerClient ?? mod?.default;
    if (typeof factory !== "function") return null;
    const client = await factory();
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return null;
    return { email: data.user.email ?? null };
  } catch {
    // lib/supabase not implemented yet — honest path: no session.
    return null;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  // Modo visualização temporário (só Preview, sem sessão): permite
  // VER o painel sem entrar. Sem registar o redirecionador de 401,
  // para que as páginas mostrem estados vazios/erro honestos em vez
  // de saltarem para o login. Auth, APIs, RLS e Production intocados.
  const viewMode = !user && isPreviewViewMode();
  if (!user && !viewMode) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-mist">
      {!viewMode && <AuthRedirectRegistrar />}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-gold-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-950"
      >
        {t.a11y.skipToContent}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userEmail={user?.email ?? null} />
        {viewMode && <PreviewViewBanner />}
        <SetupBanner />
        <main
          id="conteudo"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-28 sm:px-6 lg:pb-10"
        >
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
