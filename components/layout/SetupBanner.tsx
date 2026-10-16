"use client";

import * as React from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/supabase-browser";
import { useLocalStorageValue } from "@/lib/use-local-storage";

const DISMISS_KEY = "ath-setup-banner-dismissed";

/**
 * Non-blocking, honest banner shown while Supabase is not connected.
 * Rendered only when there is really nothing to connect to — never a fake.
 * Dismissal persists in localStorage via an SSR-safe hook (no effect needed).
 */
export function SetupBanner() {
  const [dismissed, setDismissed] = useLocalStorageValue(DISMISS_KEY);

  const visible = !isSupabaseConfigured() && dismissed !== "1";

  const dismiss = () => setDismissed("1");

  if (!visible) return null;

  return (
    <div
      role="status"
      className="border-b border-warning-600/20 bg-warning-100 px-4 py-3"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-warning-600">
            {t.setup.bannerTitle}
          </p>
          <p className="text-xs text-ink-700">{t.setup.bannerBody}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/settings"
            className="rounded-lg bg-warning-600 px-3 py-1.5 text-sm font-semibold text-paper transition-colors hover:brightness-110"
          >
            {t.setup.bannerAction}
          </Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.setup.dismiss}
            className="rounded-lg px-2 py-1.5 text-sm text-ink-500 hover:text-ink-900"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
