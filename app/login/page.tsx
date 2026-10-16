"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Logo } from "@/components/layout/Logo";
import { t } from "@/lib/i18n";
import { getBrowserSupabase, isSupabaseConfigured } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
                {t.common.appName}
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
        setError(t.auth.invalidCredentials);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-lg font-bold text-ink-900">
              {t.auth.loginTitle}
            </h1>
            <p className="text-sm text-ink-500">{t.auth.loginSubtitle}</p>
          </div>
        </div>

        {error && (
          <Alert variant="danger" className="mb-5">
            {error}
          </Alert>
        )}

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
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            {t.auth.submit}
          </Button>
        </form>
      </Card>
    </div>
  );
}
