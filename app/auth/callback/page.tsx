"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Logo } from "@/components/layout/Logo";
import { t } from "@/lib/i18n";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { resolveCallbackNext } from "@/lib/auth-redirects";

/**
 * Callback dos links de e-mail do Supabase Auth (recuperação de senha).
 *
 * Cobre os dois fluxos do Supabase:
 * - PKCE (`?code=`): troca o código pela sessão explicitamente.
 * - Implícito (`#access_token`): o cliente Supabase deteta a sessão
 *   automaticamente ao iniciar; basta ler a sessão.
 *
 * Em ambos os casos segue para o destino interno da allowlist
 * (`next`, por omissão `/login`). Links inválidos ou expirados
 * mostram o estado honesto em vez de redirecionar às cegas.
 */
function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    const resolve = async () => {
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setError(true);
        return;
      }
      const next = resolveCallbackNext(searchParams.get("next"));
      const code = searchParams.get("code");
      try {
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            setError(true);
            return;
          }
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session) {
            setError(true);
            return;
          }
        }
        router.replace(next);
      } catch {
        setError(true);
      }
    };
    resolve();
    // Corre uma única vez ao montar: o link só é válido para uma troca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
        <Card className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-lg font-bold text-ink-900">
                {t.auth.resetLinkInvalidTitle}
              </h1>
            </div>
          </div>
          <Alert variant="danger" className="mb-5">
            {t.auth.resetLinkInvalidBody}
          </Alert>
          <Link href="/login">
            <Button variant="primary" className="w-full">
              {t.auth.backToLogin}
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <p className="text-sm text-ink-500">{t.auth.sending}</p>
        </div>
      </Card>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
