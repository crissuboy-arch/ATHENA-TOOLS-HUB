import Link from "next/link";
import { TOOLS } from "@/lib/catalog/tools";
import {
  TOOL_CATEGORY_LABELS,
  type ToolCategory,
} from "@/lib/catalog/types";

export const metadata = {
  title: "Categorias — Athena Tools Hub",
  description: "Visões do catálogo por categoria de ferramenta.",
};

const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  "design-vectors": "Vetores e composição visual — editores e fluxos de design.",
  "image-photo": "Imagem e fotografia — edição, tratamento e fluxos fotográficos.",
  documents: "Documentos e publicações — criação e gestão documental.",
  video: "Vídeo — produção e renderização (executores externos).",
  research: "Pesquisa e inteligência de mercado.",
  automation: "Automação e navegação — fluxos autorizados e governados.",
  "reverse-engineering": "Análise técnica autorizada de arquivos e formatos.",
  other: "Outras capacidades do Hub.",
};

const CATEGORIES = Object.keys(TOOL_CATEGORY_LABELS) as ToolCategory[];

export default function CategoriasPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-900">Categorias</h1>
        <p className="mt-1 text-sm text-ink-500">
          Visões do catálogo por área — do design à engenharia reversa.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((category) => {
          const count = TOOLS.filter((t) => t.category === category).length;
          return (
            <Link
              key={category}
              href={`/catalog?categoria=${category}`}
              className="block rounded-xl border border-ink-100 bg-paper p-5 shadow-sm transition hover:border-gold-500 hover:shadow"
            >
              <h2 className="text-base font-semibold text-navy-900">
                {TOOL_CATEGORY_LABELS[category]}
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {CATEGORY_DESCRIPTIONS[category]}
              </p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gold-700">
                {count === 0
                  ? "Nenhuma ferramenta ainda"
                  : `${count} ${count === 1 ? "ferramenta" : "ferramentas"}`}{" "}
                → ver no catálogo
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
