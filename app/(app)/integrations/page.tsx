import Link from "next/link";
import type { Metadata } from "next";
import { getServices } from "@/lib/catalog/tools";
import StateBadge from "@/components/catalog/StateBadge";
import AppHeader from "@/components/catalog/AppHeader";

export const metadata: Metadata = { title: "Integrações" };

/**
 * POST /api/v1/integrations/[id]/test does NOT exist yet (no app/api routes
 * in the repo at all). The test button is therefore DISABLED with an honest
 * tooltip — no fake tests are ever presented.
 */

export default function IntegrationsPage() {
  const services = getServices();

  return (
    <div className="min-h-screen bg-mist">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-navy-900">Integrações</h1>
        <p className="mt-1 text-sm text-ink-500">
          Serviços externos configuráveis. Estados honestos: nada é marcado como
          operacional sem um teste real aprovado.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <div
              key={s.id}
              className="flex flex-col rounded-xl border border-ink-100 bg-paper p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-navy-900">{s.name}</h2>
                <StateBadge state={s.state} />
              </div>
              <p className="mt-2 flex-1 text-sm text-ink-500">{s.tagline}</p>
              <div className="mt-4 flex items-center gap-3">
                <Link
                  href={`/integrations/${s.id}`}
                  className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
                >
                  Configurar
                </Link>
                <button
                  type="button"
                  disabled
                  title="API em construção"
                  aria-disabled="true"
                  className="cursor-not-allowed rounded-lg border border-ink-100 px-4 py-2 text-sm font-semibold text-ink-300"
                >
                  Testar conexão
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-300">
                Teste indisponível — endpoint de teste ainda em construção.
              </p>
            </div>
          ))}
        </div>

        {/* Apify cost / limits — honest note only, no fake config inputs */}
        <section className="mt-8 rounded-xl border border-warning-600/30 bg-warning-100 p-5">
          <h2 className="text-base font-semibold text-navy-900">
            Custos e limites — Apify
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-900">
            <li>
              Os limites de gasto são configurados no{" "}
              <span className="font-semibold">painel da Apify</span>, não aqui.
              Nenhum teto digitado nesta tela seria real.
            </li>
            <li>
              A dona já paga a Apify via ScalaFlow —{" "}
              <span className="font-semibold">
                não tocar nessa integração e não criar novas contas
              </span>
              .
            </li>
            <li>
              Actors somente com tetos de orçamento definidos e aprovação da
              Cristiane antes de qualquer execução paga.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
