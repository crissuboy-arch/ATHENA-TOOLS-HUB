"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EyeIcon } from "@/components/ui/EyeIcon";
import { Logo } from "@/components/layout/Logo";
import { t } from "@/lib/i18n";
import { getBrowserSupabase } from "@/lib/supabase-browser";

/**
 * Definir nova senha após o link de recuperação.
 *
 * Só renderiza o formulário com uma sessão de recuperação válida
 * (criada pelo callback). Sem sessão, mostra o estado de link
 * inválido/expirado — nunca um formulário que não pode funcionar.
 * Após guardar, termina a sessão de recuperação e volta ao login,
 * onde surge a confirmação de senha redefinida.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = React.useState(true);
  const [hasSession, setHasSession] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      // Assíncrono de propósito: setState síncrono no corpo do
      // efeito é rejeitado pelo lint (react-hooks/set-state-in-effect).
      const timer0 = setTimeout(() => setChecking(false), 0);
      return () => clearTimeout(timer0);
    }
    // A deteção da sessão de recuperação é assíncrona: ler a
    // sessão uma única vez ao montar podia declarar o link
    // inválido antes de a deteção terminar. Ouve os eventos e
    // só declara ausência de sessão ao fim de 3 s sem ela.
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      setHasSession(false);
      setChecking(false);
    }, 3000);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (done) return;
      if (
        session &&
        (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY")
      ) {
        done = true;
        clearTimeout(timer);
        setHasSession(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (done) return;
      if (session) {
        done = true;
        clearTimeout(timer);
        setHasSession(true);
        setChecking(false);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError(t.auth.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.auth.passwordsDoNotMatch);
      return;
    }
    setLoading(true);
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("not-configured");
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setError(t.auth.unexpectedError);
        return;
      }
      // Termina a sessão de recuperação: o login passa a ser feito
      // com a nova senha, na tela de login.
      await supabase.auth.signOut();
      router.push("/login?reset=success");
    } catch {
      setError(t.auth.unexpectedError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-lg font-bold text-ink-900">
              {checking || hasSession
                ? t.auth.resetPasswordTitle
                : t.auth.resetLinkInvalidTitle}
            </h1>
            <p className="text-sm text-ink-500">
              {checking || hasSession
                ? t.auth.resetPasswordSubtitle
                : t.auth.resetLinkInvalidBody}
            </p>
          </div>
        </div>

        {checking ? (
          <p className="text-sm text-ink-500">{t.auth.sending}</p>
        ) : !hasSession ? (
          <Link href="/login">
            <Button variant="primary" className="w-full">
              {t.auth.backToLogin}
            </Button>
          </Link>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <Alert variant="danger" className="mb-5">
                {error}
              </Alert>
            )}
            <Input
              label={t.auth.newPassword}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
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
            <Input
              label={t.auth.confirmPassword}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <Button type="submit" variant="primary" className="w-full" loading={loading}>
              {t.auth.saveNewPassword}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
