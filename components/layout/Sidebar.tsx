"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./nav";
import { NavIcon, CollapseIcon, ExpandIcon } from "./icons";
import { Logo } from "./Logo";
import { t } from "@/lib/i18n";

const STORAGE_KEY = "ath-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside
      aria-label="Navegação principal"
      className={`hidden lg:flex flex-col bg-navy-900 text-paper shrink-0 transition-[width] duration-200 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      <div className="flex h-16 items-center gap-3 border-b border-paper/10 px-4">
        <Link href="/" aria-label={t.common.appName} className="shrink-0">
          <Logo size={34} />
        </Link>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">
              Athena Tools Hub
            </p>
            <p className="text-[11px] text-gold-300/80">
              {t.common.mvpNote}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Seções">
        {navSections.map((section) => (
          <div key={section.title} className="mb-5">
            {!collapsed && (
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-paper/40">
                {section.title}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                        active
                          ? "bg-paper/10 text-gold-300"
                          : "text-paper/70 hover:bg-paper/5 hover:text-paper"
                      } ${collapsed ? "justify-center" : ""}`}
                    >
                      <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
                      {!collapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-paper/10 p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={t.a11y.toggleSidebar}
          aria-expanded={!collapsed}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm text-paper/60 transition-colors hover:bg-paper/5 hover:text-paper"
        >
          {collapsed ? (
            <ExpandIcon className="h-5 w-5" />
          ) : (
            <>
              <CollapseIcon className="h-5 w-5" />
              <span>Recolher</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
