"use client";

import * as React from "react";

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Real pagination control. `onPageChange` must trigger a real data reload
 * in the parent (page, cursor, or limit change).
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  className = "",
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <nav
      aria-label="Paginação"
      className={`flex items-center justify-center gap-2 ${className}`}
    >
      <button
        type="button"
        disabled={!canPrev}
        onClick={() => onPageChange(page - 1)}
        aria-label="Página anterior"
        className="rounded-lg border border-ink-100 bg-paper px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-gold-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ←
      </button>
      <span className="px-2 text-sm text-ink-500" aria-live="polite">
        Página <strong className="text-ink-900">{page}</strong> de{" "}
        <strong className="text-ink-900">{totalPages}</strong>
      </span>
      <button
        type="button"
        disabled={!canNext}
        onClick={() => onPageChange(page + 1)}
        aria-label="Próxima página"
        className="rounded-lg border border-ink-100 bg-paper px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-gold-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        →
      </button>
    </nav>
  );
}
