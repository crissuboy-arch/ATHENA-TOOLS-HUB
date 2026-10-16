import Link from "next/link";

/**
 * Minimal app header for the MVP. The UI agent may replace this with the
 * final shell — this exists only so catalog pages are navigable standalone.
 */
const LINKS = [
  { href: "/catalog", label: "Catálogo" },
  { href: "/integrations", label: "Integrações" },
  { href: "/reverse-engineering", label: "Engenharia Reversa" },
];

export default function AppHeader() {
  return (
    <header className="border-b border-navy-800 bg-navy-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold-500 text-sm font-bold text-navy-900">
            A
          </span>
          <span className="text-sm font-semibold text-white">
            Athena <span className="text-gold-400">Tools Hub</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm text-navy-100 hover:bg-navy-800 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
