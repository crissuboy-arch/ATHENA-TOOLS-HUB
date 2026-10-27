"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { getRootRecoveryAction } from "@/lib/auth-redirects";

/**
 * Resgate de links de autenticação que aterram na raiz `/` em vez
 * do callback — acontece quando o Supabase ignora o `redirectTo`
 * (URL fora da allowlist) e volta para o Site URL (origem nua).
 *
 * A landing é um componente de servidor sem cliente Supabase: sem
 * resgate, o código/fragmento perdia-se ao clicar em "Entrar" e a
 * pessoa ficava no login sem sessão — exatamente o sintoma
 * reportado. Este componente não mostra nada e só age na raiz
 * com indicadores de recuperação:
 * - `?code=` (PKCE) → reencaminha a query intacta para
 *   `/auth/callback`, que troca o código e encaminha por
 *   `redirectType` (recuperação → `/reset-password`).
 * - Fragmento de recuperação → espera pela sessão e só então vai
 *   para `/reset-password`; sem sessão ao fim de 3 s, devolve o
 *   fragmento ao login, cuja deteção o trata (e explica o que
 *   fazer se não validar).
 * Noutras páginas ou sem indicadores, zero efeito.
 */
export function RecoveryRescue() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const action = getRootRecoveryAction(
      pathname,
      searchParams.toString(),
      window.location.hash,
    );
    if (!action) return;
    if (action === "forward-callback") {
      router.replace(`/auth/callback?${searchParams.toString()}`);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      window.location.replace(`/login${window.location.hash}`);
    }, 3000);
    const go = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      router.replace("/reset-password");
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        session &&
        (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")
      ) {
        go();
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go();
    });
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
    // O resgate só age na raiz com indicadores de recuperação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return null;
}
