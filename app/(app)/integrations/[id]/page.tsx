import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServices, getTool, isService, SERVICE_CONFIG } from "@/lib/catalog/tools";
import StateBadge from "@/components/catalog/StateBadge";
import AppHeader from "@/components/catalog/AppHeader";
import ConfigForm from "@/components/catalog/ConfigForm";

export async function generateStaticParams() {
  return getServices().map((s) => ({ id: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tool = getTool(id);
  return { title: tool && isService(id) ? `Configurar ${tool.name}` : "Integração não encontrada" };
}

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tool = getTool(id);
  if (!tool || !isService(id)) notFound();

  const config = SERVICE_CONFIG[id];

  return (
    <div className="min-h-screen bg-mist">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Link
          href="/integrations"
          className="text-sm font-medium text-gold-700 hover:underline"
        >
          ← Voltar às integrações
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-navy-900">{tool.name}</h1>
          <StateBadge state={tool.state} />
        </div>
        <p className="mt-2 text-sm text-ink-500">{tool.description}</p>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Config form */}
          <section className="rounded-xl border border-ink-100 bg-paper p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Configuração
            </h2>
            <div className="mt-3">
              <ConfigForm config={config} />
            </div>
          </section>

          {/* Permissions */}
          <section className="rounded-xl border border-ink-100 bg-paper p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Permissões
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-900">
              {config.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-500">
              Avisos
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-900">
              {config.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        </div>

        {/* Diagnostics — honest pending state */}
        <section className="mt-4 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Diagnóstico
          </h2>
          <p className="mt-2 text-sm text-ink-500">
            Nenhum diagnóstico executado. O endpoint de teste ainda está em
            construção — nenhum teste real foi realizado.
          </p>
          <button
            type="button"
            disabled
            title="API em construção"
            aria-disabled="true"
            className="mt-3 cursor-not-allowed rounded-lg border border-ink-100 px-4 py-2 text-sm font-semibold text-ink-300"
          >
            Testar conexão
          </button>
        </section>
      </main>
    </div>
  );
}
