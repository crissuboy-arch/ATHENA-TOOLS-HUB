"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * SSR-safe localStorage value.
 *
 * Why useSyncExternalStore and not useState+useEffect: reading localStorage
 * in an effect and then calling setState is exactly the cascading-render
 * pattern React 19's lint rule forbids. useSyncExternalStore is the
 * documented solution for external stores that differ between server and
 * client: the server snapshot is used for SSR/hydration (no hydration
 * mismatch warning), then the client re-reads the real value.
 *
 * Cross-tab updates are picked up via the "storage" event; same-tab writes
 * go through the returned setter (which also bumps a local tick).
 */

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // SSR or storage unavailable
  }
}

export function useLocalStorageValue(
  key: string,
): [string | null, (value: string | null) => void] {
  const [tick, setTick] = useState(0);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = (e: StorageEvent) => {
        if (e.key === key) onChange();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    // `tick` forces a re-read after same-tab writes via setValue.
    void tick;
    return readRaw(key);
  }, [key, tick]);

  const getServerSnapshot = useCallback((): string | null => null, []);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string | null) => {
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {
        /* storage unavailable: value lives only for this render cycle */
      }
      setTick((t) => t + 1);
    },
    [key],
  );

  return [value, setValue];
}
