import * as React from "react";

function base(className: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function DashboardIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function CatalogIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function JobsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z" />
    </svg>
  );
}

export function ApprovalsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    </svg>
  );
}

export function ResultsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16M7 14l4-4 4 4 5-6" />
    </svg>
  );
}

export function ReverseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v5m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-5M3 16v5a2 2 0 0 0 2 2h3" />
      <path d="M9.5 12.5 11 11l-1.5-1.5M14.5 9.5 16 11l-1.5 1.5" />
    </svg>
  );
}

export function IntegrationsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
    </svg>
  );
}

export function SettingsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M10.34 3.26 10 2h4l-.34 1.26a6 6 0 0 1 3.5 2.16l1.2-.5 2 3.46-1.13.66c.12.62.17 1.27.17 1.92s-.05 1.3-.17 1.92l1.13.66-2 3.46-1.2-.5a6 6 0 0 1-3.5 2.16L14 22h-4l.34-1.26a6 6 0 0 1-3.5-2.16l-1.2.5-2-3.46 1.13-.66a8 8 0 0 1 0-3.84l-1.13-.66 2-3.46 1.2.5a6 6 0 0 1 3.5-2.16Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function BellIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M14.86 17.08a2 2 0 0 1-3.72 0M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    </svg>
  );
}

export function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CollapseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ExpandIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function LogoutIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...base(className)}>
      <path d="M15 12H3m0 0 4-4m-4 4 4 4M21 4v7a3 3 0 0 1-3 3h-6" />
    </svg>
  );
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: DashboardIcon,
  catalog: CatalogIcon,
  jobs: JobsIcon,
  approvals: ApprovalsIcon,
  results: ResultsIcon,
  reverse: ReverseIcon,
  integrations: IntegrationsIcon,
  settings: SettingsIcon,
};

export function NavIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = iconMap[name] ?? DashboardIcon;
  return <Icon className={className} />;
}
