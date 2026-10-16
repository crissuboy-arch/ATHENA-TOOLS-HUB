"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchInput } from "@/components/ui/SearchInput";
import { BellIcon, LogoutIcon } from "./icons";
import { Logo } from "./Logo";
import { t } from "@/lib/i18n";
import { getBrowserSupabase } from "@/lib/supabase-browser";

interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  created_at?: string;
  read?: boolean;
}

export function Topbar({ userEmail }: { userEmail?: string | null }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [userOpen, setUserOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationItem[] | null>(
    null
  );
  const [loggingOut, setLoggingOut] = React.useState(false);

  // Load notifications honestly: any failure (endpoint missing, offline)
  // means "no notifications to show", never invented items.
  React.useEffect(() => {
    if (!notifOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/notifications?limit=10");
        if (!res.ok) throw new Error("unavailable");
        const json = await res.json();
        const items: NotificationItem[] =
          json?.data ?? json?.items ?? (Array.isArray(json) ? json : []);
        if (!cancelled) setNotifications(items.slice(0, 10));
      } catch {
        if (!cancelled) setNotifications([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notifOpen]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submitSearch = (value: string) => {
    const q = value.trim();
    router.push(q ? `/catalog?q=${encodeURIComponent(q)}` : "/catalog");
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      const supabase = getBrowserSupabase();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      /* ignore — still leave the shell */
    } finally {
      setUserOpen(false);
      router.push("/login");
      router.refresh();
    }
  };

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-100 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label={t.common.appName} className="lg:hidden shrink-0">
          <Logo size={30} />
        </Link>

        <div className="hidden sm:block w-full max-w-md">
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={submitSearch}
            label={t.common.search}
            placeholder={t.common.searchPlaceholder}
          />
        </div>
        <div className="sm:hidden flex-1" />

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((v) => !v);
                setUserOpen(false);
              }}
              aria-label={t.a11y.notifications}
              aria-expanded={notifOpen}
              aria-haspopup="true"
              className="relative rounded-xl p-2.5 text-ink-500 transition-colors hover:bg-mist hover:text-ink-900"
            >
              <BellIcon className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold text-paper">
                  {unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setNotifOpen(false)}
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                />
                <div
                  role="menu"
                  aria-label={t.notifications.title}
                  className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-ink-100 bg-paper shadow-xl"
                >
                  <p className="border-b border-ink-100 px-4 py-3 text-sm font-semibold text-ink-900">
                    {t.notifications.title}
                  </p>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications === null ? (
                      <p className="px-4 py-8 text-center text-sm text-ink-500">
                        {t.common.loading}
                      </p>
                    ) : notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <p className="text-sm font-medium text-ink-700">
                          {t.notifications.empty}
                        </p>
                        <p className="mt-1 text-xs text-ink-500">
                          {t.notifications.emptyHint}
                        </p>
                      </div>
                    ) : (
                      <ul>
                        {notifications.map((n) => (
                          <li
                            key={n.id}
                            className="border-b border-ink-100 px-4 py-3 last:border-0"
                          >
                            <p className="text-sm font-medium text-ink-900">
                              {n.title}
                            </p>
                            {n.body && (
                              <p className="mt-0.5 text-xs text-ink-500">
                                {n.body}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setUserOpen((v) => !v);
                setNotifOpen(false);
              }}
              aria-label={t.a11y.userMenu}
              aria-expanded={userOpen}
              aria-haspopup="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-gold-300 transition-colors hover:bg-navy-800"
            >
              {userEmail ? userEmail.charAt(0).toUpperCase() : "•"}
            </button>
            {userOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setUserOpen(false)}
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                />
                <div
                  role="menu"
                  aria-label={t.a11y.userMenu}
                  className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-ink-100 bg-paper py-1 shadow-xl"
                >
                  {userEmail && (
                    <p
                      className="truncate border-b border-ink-100 px-4 py-2.5 text-sm text-ink-500"
                      title={userEmail}
                    >
                      {userEmail}
                    </p>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={logout}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-100 disabled:opacity-50"
                  >
                    <LogoutIcon className="h-4 w-4" />
                    {loggingOut ? t.common.loading : t.nav.logout}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
