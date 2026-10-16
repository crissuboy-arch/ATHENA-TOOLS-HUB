"use client";

import { useRef, useState } from "react";
import { RE_ANALYSIS_TYPES, RE_MAX_UPLOAD_MB } from "@/lib/catalog/tools";
import AppHeader from "@/components/catalog/AppHeader";

/**
 * Reverse-engineering MODULE (not a tool). No REA adapter integration exists:
 * the upload endpoint POST /api/v1/re-jobs does not exist yet, so the upload
 * zone is honestly DISABLED — nothing is uploaded or faked.
 */

const ACCEPT =
  ".zip,.tar,.gz,.tgz,.apk,.exe,.dll,.so,.bin,.pdf,.txt,.log,.json,.xml,.html,.js,.py";

export default function ReverseEngineeringPage() {
  const [analysisType, setAnalysisType] = useState<string>(RE_ANALYSIS_TYPES[0]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function validateFile(file: File): string | null {
    const maxBytes = RE_MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      return `Arquivo excede o limite de ${RE_MAX_UPLOAD_MB}MB (${(file.size / 1024 / 1024).toFixed(1)}MB).`;
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-mist">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-navy-900">Engenharia Reversa</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">
          Módulo para análise técnica de artefatos digitais — arquivos, páginas,
          APIs e formatos — com o objetivo de entender estrutura, comportamento
          e integrações possíveis.
        </p>

        {/* Authorization notice */}
        <div
          role="note"
          className="mt-4 rounded-lg border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600"
        >
          <span className="font-semibold">Aviso de autorização:</span> análises
          somente em artefatos próprios ou com autorização expressa do titular.
          Enviar material de terceiros sem autorização é proibido.
        </div>

        {/* REA adapter pending banner */}
        <div
          role="status"
          className="mt-4 rounded-lg border border-warning-600/30 bg-warning-100 px-4 py-3 text-sm text-warning-600"
        >
          <span className="font-semibold">REA adapter: pendente de verificação</span>{" "}
          (repo/licença/riscos/sandbox) — nenhuma integração foi feita.
        </div>

        {/* Analysis type picker */}
        <section className="mt-6 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Tipo de análise
          </h2>
          <label htmlFor="re-analysis-type" className="sr-only">
            Tipo de análise
          </label>
          <select
            id="re-analysis-type"
            value={analysisType}
            onChange={(e) => setAnalysisType(e.target.value)}
            className="mt-3 w-full rounded-lg border border-ink-100 bg-paper px-3 py-2.5 text-sm text-ink-900 sm:max-w-md"
          >
            {RE_ANALYSIS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </section>

        {/* Upload zone — disabled until the endpoint exists */}
        <section className="mt-4 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Enviar artefato
          </h2>
          <div className="mt-3 rounded-lg border-2 border-dashed border-ink-300 bg-mist p-8 text-center opacity-70">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              disabled
              aria-disabled="true"
              title="Endpoint em construção"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFileError(f ? validateFile(f) : null);
              }}
            />
            <p className="text-sm font-semibold text-ink-500">
              Envio desabilitado — endpoint em construção
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Tipos aceitos: {ACCEPT} · limite de {RE_MAX_UPLOAD_MB}MB por arquivo
              (validação no cliente quando o envio estiver ativo).
            </p>
            <p className="mt-2 text-xs font-medium text-warning-600">
              Nenhum arquivo foi enviado. O upload para /api/v1/re-jobs será
              habilitado quando o endpoint existir.
            </p>
            {fileError && (
              <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
                {fileError}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Tipo selecionado: <span className="font-semibold">{analysisType}</span>
          </p>
        </section>

        {/* History — honest empty state */}
        <section className="mt-4 rounded-xl border border-ink-100 bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Histórico de análises
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-xs uppercase text-ink-500">
                  <th className="py-2 pr-4 font-semibold">Trabalho</th>
                  <th className="py-2 pr-4 font-semibold">Tipo</th>
                  <th className="py-2 pr-4 font-semibold">Estado</th>
                  <th className="py-2 font-semibold">Criado em</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-ink-500">
                    Nenhum trabalho de engenharia reversa ainda. O histórico
                    aparece aqui quando o endpoint estiver disponível.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
