"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileNavItems } from "./nav";
import { NavIcon } from "./icons";

/** Bottom tab bar, visible only below the lg breakpoint. */
export function MobileNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      aria-label="Navegação móvel"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-ink-100 bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80"
    >
      <ul className="grid grid-cols-5">
        {mobileNavItems.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-gold-600" : "text-ink-500 hover:text-ink-900"
                }`}
              >
                <NavIcon name={item.icon} className="h-5 w-5" />
                <span className="truncate max-w-full px-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
