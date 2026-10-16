export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * App navigation — the 9 canonical interface areas from the Master Blueprint:
 * Dashboard, Catálogo, Categorias, Conectadas, Criar tarefa, Execuções,
 * Aprovações, Biblioteca, Configurações (+ Engenharia Reversa module).
 * Icon keys resolve to components in `./icons`.
 */
export const navSections: NavSection[] = [
  {
    title: "Principal",
    items: [{ href: "/", label: "Dashboard", icon: "dashboard" }],
  },
  {
    title: "Ferramentas",
    items: [
      { href: "/catalog", label: "Catálogo", icon: "catalog" },
      { href: "/categorias", label: "Categorias", icon: "catalog" },
      { href: "/jobs/new", label: "Criar tarefa", icon: "jobs" },
      { href: "/jobs", label: "Execuções", icon: "jobs" },
      { href: "/approvals", label: "Aprovações", icon: "approvals" },
      { href: "/results", label: "Biblioteca", icon: "results" },
      {
        href: "/reverse-engineering",
        label: "Engenharia Reversa",
        icon: "reverse",
      },
    ],
  },
  {
    title: "Administração",
    items: [
      { href: "/integrations", label: "Conectadas", icon: "integrations" },
      { href: "/settings", label: "Configurações", icon: "settings" },
    ],
  },
];

/** Bottom tab bar items for mobile (subset). */
export const mobileNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/catalog", label: "Catálogo", icon: "catalog" },
  { href: "/jobs/new", label: "Criar", icon: "jobs" },
  { href: "/approvals", label: "Aprovações", icon: "approvals" },
  { href: "/settings", label: "Ajustes", icon: "settings" },
];
