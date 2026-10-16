import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/layout/Logo";
import { Badge } from "@/components/ui/Badge";
import { t } from "@/lib/i18n";

function ModuleIcon({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-navy-800 text-gold-300"
    >
      <svg
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </div>
  );
}

const modules = [
  {
    key: "catalog",
    icon: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  {
    key: "jobs",
    icon: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z" />,
  },
  {
    key: "approvals",
    icon: (
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    ),
  },
  {
    key: "results",
    icon: <path d="M3 3v16a2 2 0 0 0 2 2h16M7 14l4-4 4 4 5-6" />,
  },
  {
    key: "integrations",
    icon: <path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />,
  },
  {
    key: "reverse",
    icon: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v5m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-5M3 16v5a2 2 0 0 0 2 2h3" />
        <path d="M9.5 12.5 11 11l-1.5-1.5M14.5 9.5 16 11l-1.5 1.5" />
      </>
    ),
  },
  {
    key: "governance",
    icon: (
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    ),
  },
] as const;

// NOTE: no emoji anywhere — icons are stroke SVGs.
const moduleText: Record<
  (typeof modules)[number]["key"],
  { title: string; body: string }
> = {
  catalog: t.landing.modules.catalog,
  jobs: t.landing.modules.jobs,
  approvals: t.landing.modules.approvals,
  results: t.landing.modules.results,
  integrations: t.landing.modules.integrations,
  reverse: t.landing.modules.reverse,
  governance: t.landing.modules.governance,
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-paper">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-gold-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-950"
      >
        {t.a11y.skipToContent}
      </a>

      {/* Header */}
      <header className="border-b border-paper/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <span className="text-base font-bold tracking-tight">
              Athena Tools Hub
            </span>
          </div>
          <nav aria-label="Ações">
            <Link
              href="/login"
              className="rounded-lg bg-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-gold-400"
            >
              {t.nav.login}
            </Link>
          </nav>
        </div>
      </header>

      <main id="conteudo">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 0%, rgba(198,161,91,0.14) 0%, transparent 100%)",
            }}
          />
          <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <Badge variant="gold" className="mb-6">
              {t.landing.badge}
            </Badge>
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
              {t.landing.heroTitle}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-paper/70">
              {t.landing.heroSubtitle}
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="w-full rounded-xl bg-gold-500 px-8 py-3.5 text-base font-semibold text-navy-950 transition-colors hover:bg-gold-400 sm:w-auto"
              >
                {t.landing.enter}
              </Link>
              <Link
                href="/catalog"
                className="w-full rounded-xl border border-paper/25 px-8 py-3.5 text-base font-semibold text-paper transition-colors hover:border-gold-300 hover:text-gold-300 sm:w-auto"
              >
                {t.landing.viewCatalog}
              </Link>
            </div>
            <p className="mx-auto mt-8 max-w-xl text-xs text-paper/50">
              {t.landing.honestNote}
            </p>
          </div>
        </section>

        {/* Modules */}
        <section
          aria-label="Módulos"
          className="border-t border-paper/10 bg-navy-900"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => {
                const text = moduleText[m.key];
                return (
                  <article
                    key={m.key}
                    className="rounded-2xl border border-paper/10 bg-navy-950/60 p-6"
                  >
                    <ModuleIcon>{m.icon}</ModuleIcon>
                    <h2 className="text-lg font-semibold text-paper">
                      {text.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-paper/60">
                      {text.body}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-paper/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-sm text-paper/60">
              Athena Tools Hub · {t.common.mvpNote}
            </span>
          </div>
          <Link
            href="/login"
            className="text-sm font-semibold text-gold-300 hover:text-gold-400"
          >
            {t.nav.login} →
          </Link>
        </div>
      </footer>
    </div>
  );
}
