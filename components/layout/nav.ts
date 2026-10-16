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
 * App navigation. Icon keys resolve to components in `./icons`.
 * Routes are real app routes (pages land here in later milestones).
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
      { href: "/jobs", label: "Execuções", icon: "jobs" },
      { href: "/approvals", label: "Aprovações", icon: "approvals" },
      { href: "/results", label: "Resultados", icon: "results" },
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
      { href: "/integrations", label: "Integrações", icon: "integrations" },
      { href: "/settings", label: "Configurações", icon: "settings" },
    ],
  },
];

/** Bottom tab bar items for mobile (subset). */
export const mobileNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/catalog", label: "Catálogo", icon: "catalog" },
  { href: "/jobs", label: "Execuções", icon: "jobs" },
  { href: "/approvals", label: "Aprovações", icon: "approvals" },
  { href: "/settings", label: "Configurações", icon: "settings" },
];
