"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EyeIcon } from "@/components/ui/EyeIcon";
import { Logo } from "@/components/layout/Logo";
import { t } from "@/lib/i18n";
import { getBrowserSupabase, isSupabaseConfigured } from "@/lib/supabase-browser";
import {
  buildPasswordResetRedirect,
  isRecoveryHash,
} from "@/lib/auth-redirects";
import {
  classifyAuthError,
  classifyHashError,
  parseHashError,
} from "@/lib/auth-errors";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"login" | "forgot">(
    searchParams.get("mode") === "forgot" ? "forgot" : "login",
  );
  const [forgotLoading, setForgotLoading] = React.useState(false);
  const [forgotSent, setForgotSent] = React.useState(false);
  const [forgotError, setForgotError] = React.useState<string | null>(null);
  const [forgotRateLimited, setForgotRateLimited] = React.useState(false);
  const [recoveryStuck, setRecoveryStuck] = React.useState(false);
  const resetDone = searchParams.get("reset") === "success";

  // Verificação falhada que aterrou na tela de login: quando o
  // Supabase rejeita o token do link (expirado, já utilizado) e o
  // Site URL aponta para o login, o fragmento traz o erro — e a
  // tela tem de o explicar, em vez de mostrar o login como se nada
  // tivesse acontecido. Assíncrono de propósito (lint).
  React.useEffect(() => {
    const hashError = parseHashError(window.location.hash);
    if (!hashError) return;
    const kind = classifyHashError(hashError);
    const timer = setTimeout(() => {
      setError(
        kind === "token-expired"
          ? t.auth.resetLinkExpiredBody
          : t.auth.resetLinkInvalidBody,
      );
    }, 0);
    return () => clearTimeout(timer);
    // Corre uma única vez ao montar: o fragmento só existe no link.
  }, []);

  // Recuperação que chegou à tela de login em vez do callback: quando
  // o Supabase ignora o redirectTo (URL fora da allowlist) e volta
  // para o Site URL, a sessão de recuperação pode aterrar aqui, no
  // fragmento da URL. Nesse caso, encaminhar para /reset-password —
  // nunca deitar fora o fragmento nem mostrar o login como se nada
  // tivesse acontecido. Sem fragmento de recuperação, zero efeito.
  React.useEffect(() => {
    if (!isRecoveryHash(window.location.hash)) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let done = false;
    // Sem sessão ao fim de 3 s, o link não vai validar neste
    // navegador (verificador PKCE noutra origem/aplicação, ou link
    // já utilizado): antes, a tela ficava no formulário de login
    // sem explicar nada — que é exatamente o sintoma reportado.
    // O aviso diz o que fazer (novo link a partir deste endereço,
    // aberto no mesmo navegador) em vez de deixar tentar a senha
    // antiga, que é a que foi esquecida.
    const stuckTimer = setTimeout(() => {
      if (done) return;
      const timer = setTimeout(() => setRecoveryStuck(true), 0);
      void timer;
    }, 3000);
    const go = () => {
      if (done) return;
      done = true;
      clearTimeout(stuckTimer);
      router.replace("/reset-password");
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
      if (event === "PASSWORD_RECOVERY" && session) go();
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go();
    });
    return () => {
      clearTimeout(stuckTimer);
      subscription.unsubscribe();
    };
    // Corre uma única vez ao montar: o fragmento só existe no link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Honest state: without Supabase there is no auth backend — explain,
  // don't render a login form that can never work.
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
        <Card className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-lg font-bold text-ink-900">
                {t.auth.loginTitle}
              </h1>
            </div>
          </div>
          <Alert variant="warning" title={t.auth.setupRequiredTitle}>
            <p>{t.auth.setupRequiredBody}</p>
          </Alert>
          <div className="mt-6">
            <Link href="/settings">
              <Button variant="primary" className="w-full">
                {t.auth.goToSettings}
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("not-configured");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        const kind = classifyAuthError(signInError);
        setError(
          kind === "email-not-confirmed"
            ? t.auth.emailNotConfirmed
            : kind === "email-rate-limited"
              ? t.auth.emailRateLimited
              : t.auth.invalidCredentials,
        );
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(t.auth.unexpectedError);
    } finally {
      setLoading(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("not-configured");
      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: buildPasswordResetRedirect(window.location.origin),
        });
      if (resetError) {
        // Limite atingido: dizê-lo e bloquear novos pedidos nesta
        // sessão da página — pedir mais links não ajuda e só atrasa
        // o desbloqueio. Nunca há repetição automática.
        if (classifyAuthError(resetError) === "email-rate-limited") {
          setForgotRateLimited(true);
          setForgotError(t.auth.emailRateLimited);
        } else {
          setForgotError(t.auth.unexpectedError);
        }
        return;
      }
      setForgotSent(true);
    } catch {
      setForgotError(t.auth.unexpectedError);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-lg font-bold text-ink-900">
              {mode === "forgot"
                ? t.auth.forgotPasswordTitle
                : t.auth.loginTitle}
            </h1>
            <p className="text-sm text-ink-500">
              {mode === "forgot"
                ? t.auth.forgotPasswordBody
                : t.auth.loginSubtitle}
            </p>
          </div>
        </div>

        {resetDone && mode === "login" && (
          <Alert variant="success" className="mb-5">
            {t.auth.resetSuccess}
          </Alert>
        )}

        {error && mode === "login" && (
          <Alert variant="danger" className="mb-5">
            {error}
          </Alert>
        )}

        {recoveryStuck && mode === "login" && (
          <Alert variant="warning" className="mb-5">
            {t.auth.recoveryStuckBody}
          </Alert>
        )}

        {mode === "login" ? (
          <>
            <form onSubmit={submit} className="space-y-4">
              <Input
                label={t.auth.email}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
              />
              <Input
                label={t.auth.password}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                trailing={
                  <button
                    type="button"
                    aria-label={
                      showPassword ? t.auth.hidePassword : t.auth.showPassword
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-ink-500 hover:text-ink-900 focus:outline-none"
                  >
                    <EyeIcon off={showPassword} />
                  </button>
                }
              />
              <Button type="submit" variant="primary" className="w-full" loading={loading}>
                {t.auth.submit}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                }}
                className="text-sm font-medium text-gold-600 hover:underline focus:outline-none"
              >
                {t.auth.forgotPassword}
              </button>
            </div>
          </>
        ) : forgotRateLimited ? (
          <>
            <Alert variant="danger" className="mb-5">
              {forgotError ?? t.auth.emailRateLimited}
            </Alert>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                setMode("login");
                setForgotRateLimited(false);
                setForgotError(null);
              }}
            >
              {t.auth.backToLogin}
            </Button>
          </>
        ) : forgotSent ? (
          <>
            <Alert variant="success" className="mb-5">
              {t.auth.recoveryLinkSent}
            </Alert>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                setMode("login");
                setForgotSent(false);
              }}
            >
              {t.auth.backToLogin}
            </Button>
          </>
        ) : (
          <form onSubmit={submitForgot} className="space-y-4">
            {forgotError && (
              <Alert variant="danger" className="mb-5">
                {forgotError}
              </Alert>
            )}
            <Input
              label={t.auth.email}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
            />
            <Button type="submit" variant="primary" className="w-full" loading={forgotLoading}>
              {t.auth.sendRecoveryLink}
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setForgotError(null);
                }}
                className="text-sm font-medium text-gold-600 hover:underline focus:outline-none"
              >
                {t.auth.backToLogin}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
