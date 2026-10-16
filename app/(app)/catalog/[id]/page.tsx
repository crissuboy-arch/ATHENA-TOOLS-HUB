import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TOOLS, getTool, relatedTools } from "@/lib/catalog/tools";
import { TOOL_CATEGORY_LABELS } from "@/lib/catalog/types";
import StateBadge from "@/components/catalog/StateBadge";
import AppHeader from "@/components/catalog/AppHeader";

export async function generateStaticParams() {
  return TOOLS.map((t) => ({ id: t.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tool = getTool(id);
  return { title: tool ? tool.name : "Ferramenta não encontrada" };
}

function StateBanner({ state }: { state: string }) {
  if (state === "operational-tested") return null;
  const message =
    state === "needs-config"
      ? "Aguardando configuração — nenhuma execução real disponível."
      : state === "in-development"
        ? "Integração em desenvolvimento — nenhuma execução real disponível."
        : state === "error"
          ? "Esta ferramenta está com erro registrado — nenhuma execução real disponível."
          : state === "unavailable"
            ? "Ferramenta indisponível no momento."
            : "Integração pendente — nenhuma execução real disponível.";
  return (
    <div
      role="status"
      className="mt-4 rounded-lg border border-warning-600/30 bg-warning-100 px-4 py-3 text-sm text-warning-600"
    >
      {message}
    </div>
  );
}

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tool = getTool(id);
  if (!tool) notFound();

  const related = relatedTools(tool);

  return (
    <div className="min-h-screen bg-mist">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link href="/catalog" className="text-sm font-medium text-gold-700 hover:underline">
          ← Voltar ao catálogo
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-navy-900">{tool.name}</h1>
          <StateBadge state={tool.state} />
        </div>
        <p className="mt-1 text-sm font-medium text-ink-500">
          {TOOL_CATEGORY_LABELS[tool.category]}
        </p>
        <p className="mt-3 text-base text-ink-700">{tool.tagline}</p>

        <StateBanner state={tool.state} />

        <section className="mt-6 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Descrição
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-900">{tool.description}</p>
        </section>

        <section className="mt-4 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Capacidades
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-900">
            {tool.capabilities.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <section className="rounded-xl border border-ink-100 bg-paper p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Requisitos
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-900">
              {tool.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-ink-100 bg-paper p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Dependências
            </h2>
            {tool.dependencies.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-900">
                {tool.dependencies.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-500">Nenhuma dependência interna.</p>
            )}
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Código e licença
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {tool.repoUrl && (
              <a
                href={tool.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-info-600 hover:underline"
              >
                Repositório ↗
              </a>
            )}
            {tool.website && (
              <a
                href={tool.website}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-info-600 hover:underline"
              >
                Site oficial ↗
              </a>
            )}
            {tool.license ? (
              <span className="inline-flex items-center rounded-full bg-success-100 px-2.5 py-0.5 text-xs font-semibold text-success-600">
                Licença: {tool.license}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-500">
                Licença não informada — verificar antes de adaptar código
              </span>
            )}
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Ferramentas relacionadas
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={`/catalog/${r.id}`}
                  className="rounded-xl border border-ink-100 bg-paper p-4 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-navy-900">{r.name}</h3>
                    <StateBadge state={r.state} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{r.tagline}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
