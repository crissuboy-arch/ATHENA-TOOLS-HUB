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
import {
  classifyHashError,
  parseHashError,
} from "@/lib/auth-errors";

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
  const [errorKind, setErrorKind] = React.useState<
    "invalid" | "expired" | null
  >(null);

  React.useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      // Assíncrono de propósito: setState síncrono no corpo do
      // efeito é rejeitado pelo lint (react-hooks/set-state-in-effect).
      const timer0 = setTimeout(() => setErrorKind("invalid"), 0);
      return () => clearTimeout(timer0);
    }
    // Verificação rejeitada pelo Supabase (ex.: token expirado ou
    // já utilizado): o fragmento traz o erro — distingui-lo em vez
    // de mostrar sempre o genérico.
    const hashError = parseHashError(window.location.hash);
    if (hashError) {
      const kind = classifyHashError(hashError);
      const timer0 = setTimeout(
        () => setErrorKind(kind === "token-expired" ? "expired" : "invalid"),
        0,
      );
      return () => clearTimeout(timer0);
    }
    const next = resolveCallbackNext(searchParams.get("next"));
    const code = searchParams.get("code");
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (ok) router.replace(next);
      else setErrorKind("invalid");
    };
    // A deteção automática do fragmento (#access_token) é assíncrona:
    // ouvir o evento SIGNED_IN evita declarar o link inválido por uma
    // corrida entre a leitura da sessão e a deteção do fragmento.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) finish(true);
    });
    const resolve = async () => {
      try {
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          finish(!exchangeError);
        } else {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session) finish(true);
          else timer = setTimeout(() => finish(false), 3000);
        }
      } catch {
        finish(false);
      }
    };
    resolve();
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
    // Corre uma única vez ao montar: o link só é válido para uma troca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (errorKind) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
        <Card className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-lg font-bold text-ink-900">
                {errorKind === "expired"
                  ? t.auth.resetLinkExpiredTitle
                  : t.auth.resetLinkInvalidTitle}
              </h1>
            </div>
          </div>
          <Alert variant="danger" className="mb-5">
            {errorKind === "expired"
              ? t.auth.resetLinkExpiredBody
              : t.auth.resetLinkInvalidBody}
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
          <p className="text-sm text-ink-500">{t.auth.processingLink}</p>
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
