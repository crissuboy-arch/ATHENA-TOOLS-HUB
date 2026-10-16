"use client";

import { useState } from "react";
import type { ServiceConfig } from "@/lib/catalog/tools";

/**
 * Config form. The backend API does not exist yet, so submitting shows an
 * honest pending notice — nothing is saved or sent anywhere.
 */
export default function ConfigForm({ config }: { config: ServiceConfig }) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
      className="space-y-4"
    >
      {config.fields.map((f) => (
        <div key={f.key}>
          <label
            htmlFor={`cfg-${f.key}`}
            className="block text-sm font-semibold text-navy-900"
          >
            {f.label}
          </label>
          {f.type === "select" ? (
            <select
              id={`cfg-${f.key}`}
              name={f.key}
              className="mt-1 w-full rounded-lg border border-ink-100 bg-paper px-3 py-2 text-sm text-ink-900"
            >
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`cfg-${f.key}`}
              name={f.key}
              type={f.type}
              placeholder={f.placeholder}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-ink-100 bg-paper px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300"
            />
          )}
          {f.hint && <p className="mt-1 text-xs text-ink-500">{f.hint}</p>}
        </div>
      ))}

      <button
        type="submit"
        className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
      >
        Salvar configuração
      </button>

      {submitted && (
        <div
          role="status"
          className="rounded-lg border border-warning-600/30 bg-warning-100 px-4 py-3 text-sm text-warning-600"
        >
          Salvamento indisponível — a API de configuração ainda está em
          construção. <span className="font-semibold">Nenhum dado foi salvo ou enviado.</span>
        </div>
      )}
    </form>
  );
}
