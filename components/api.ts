"use client";

import * as React from "react";

/**
 * Shared client-side helpers for fetching real data from /api/v1/*.
 *
 * Honest contract: responses are expected to be an array, or an object with
 * { data } / { items } / { results } plus optional { total } / { count }.
 * Anything else is treated as "no data" — never invented. Network/HTTP
 * failures surface as `error: true`; the UI must render an honest
 * unavailable state (with retry) and never fake the numbers.
 */

export type ApiRecord = Record<string, unknown>;

export interface ApiListState {
  items: ApiRecord[];
  total: number | null;
  loading: boolean;
  error: boolean;
  /** Re-runs the GET request (used by "retry" buttons on error states). */
  reload: () => void;
}

export function parseList(json: unknown): ApiRecord[] {
  if (Array.isArray(json)) return json as ApiRecord[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as ApiRecord[];
    }
  }
  return [];
}

export function parseTotal(json: unknown, items: ApiRecord[]): number | null {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["total", "count"]) {
      if (typeof obj[key] === "number") return obj[key] as number;
    }
  }
  return items.length;
}

export function useApiList(url: string): ApiListState {
  const [items, setItems] = React.useState<ApiRecord[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);

  // No synchronous setState in the effect body (React 19 lint rule):
  // every setState happens after an `await`, inside the async continuation.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = parseList(json);
        if (!cancelled) {
          setItems(parsed);
          setTotal(parseTotal(json, parsed));
          setError(false);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setTotal(null);
          setError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, retryKey]);

  const reload = React.useCallback(() => {
    // Raises the loading flag synchronously (event handler — allowed) and
    // bumps the key so the effect above refetches.
    setLoading(true);
    setError(false);
    setRetryKey((k) => k + 1);
  }, []);

  return { items, total, loading, error, reload };
}
