"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TOOLS } from "@/lib/catalog/tools";
import {
  TOOL_CATEGORY_LABELS,
  TOOL_STATE_LABELS,
  type ToolCategory,
  type ToolState,
} from "@/lib/catalog/types";
import StateBadge from "@/components/catalog/StateBadge";
import AppHeader from "@/components/catalog/AppHeader";

const CATEGORIES: Array<ToolCategory | "all"> = [
  "all",
  "design-vectors",
  "image-photo",
  "documents",
  "video",
  "research",
  "automation",
  "reverse-engineering",
  "other",
];

const STATES: Array<ToolState | "all"> = [
  "all",
  "cataloged",
  "needs-config",
  "in-development",
  "connected",
  "operational-tested",
  "error",
  "unavailable",
];

function matches(tool: (typeof TOOLS)[number], q: string) {
  const hay = `${tool.name} ${tool.tagline} ${tool.description}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

function isCategory(value: string | null): value is ToolCategory {
  return (
    value !== null &&
    (CATEGORIES as string[]).includes(value) &&
    value !== "all"
  );
}

function CatalogContent() {
  const searchParams = useSearchParams();
  const initialCategory = isCategory(searchParams.get("categoria"))
    ? (searchParams.get("categoria") as ToolCategory)
    : "all";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ToolCategory | "all">(initialCategory);
  const [state, setState] = useState<ToolState | "all">("all");

  const results = useMemo(() => {
    return TOOLS.filter(
      (t) =>
        (category === "all" || t.category === category) &&
        (state === "all" || t.state === state) &&
        (query.trim() === "" || matches(t, query.trim()))
    );
  }, [query, category, state]);

  const showEbookPlaceholder =
    (category === "all" || category === "documents") &&
    query.trim() === "" &&
    state === "all";

  const hasFilters = query.trim() !== "" || category !== "all" || state !== "all";

  return (
    <div className="min-h-screen bg-mist">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-navy-900">Catálogo de ferramentas</h1>
        <p className="mt-1 text-sm text-ink-500">
          Ferramentas reais, com estados honestos. Nada aqui está marcado como
          operacional sem um teste real aprovado.
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-col gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou descrição…"
            aria-label="Buscar ferramentas"
            className="w-full rounded-lg border border-ink-100 bg-paper px-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-300"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoria">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  category === c
                    ? "bg-navy-900 text-white"
                    : "bg-paper text-ink-500 ring-1 ring-ink-100 hover:text-navy-900"
                }`}
              >
                {c === "all" ? "Todas" : TOOL_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="state-filter" className="text-xs font-semibold text-ink-500">
              Estado:
            </label>
            <select
              id="state-filter"
              value={state}
              onChange={(e) => setState(e.target.value as ToolState | "all")}
              className="rounded-lg border border-ink-100 bg-paper px-3 py-1.5 text-xs text-ink-900"
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "Todos" : TOOL_STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Grid */}
        {results.length > 0 || showEbookPlaceholder ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((tool) => (
              <Link
                key={tool.id}
                href={`/catalog/${tool.id}`}
                className="flex flex-col rounded-xl border border-ink-100 bg-paper p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy-900">{tool.name}</h2>
                  <StateBadge state={tool.state} />
                </div>
                <p className="mt-2 text-sm text-ink-500">{tool.tagline}</p>
                <p className="mt-3 text-xs font-medium text-gold-700">
                  {TOOL_CATEGORY_LABELS[tool.category]}
                </p>
              </Link>
            ))}

            {showEbookPlaceholder && (
              <div
                aria-label="Categoria planejada: ferramentas de e-book"
                className="flex flex-col rounded-xl border border-dashed border-ink-300 bg-mist p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink-500">
                    Ferramentas de e-book
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-500">
                    Planejado
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-500">
                  Categoria reservada para o futuro. Ainda não é uma ferramenta —
                  nenhuma capacidade foi prometida.
                </p>
                <p className="mt-3 text-xs font-medium text-ink-300">
                  {TOOL_CATEGORY_LABELS.documents}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-ink-100 bg-paper p-10 text-center">
            <p className="text-base font-semibold text-navy-900">
              Nenhuma ferramenta encontrada
            </p>
            <p className="mt-1 text-sm text-ink-500">
              Tente outro termo ou limpe os filtros aplicados.
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                  setState("all");
                }}
                className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-500">Carregando catálogo…</div>}>
      <CatalogContent />
    </Suspense>
  );
}
