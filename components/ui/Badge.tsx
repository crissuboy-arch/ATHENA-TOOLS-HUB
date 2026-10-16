import * as React from "react";

type BadgeVariant =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "gold";

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-mist text-ink-700",
  active: "bg-navy-100 text-navy-800",
  success: "bg-success-100 text-success-600",
  warning: "bg-warning-100 text-warning-600",
  danger: "bg-danger-100 text-danger-600",
  info: "bg-info-100 text-info-600",
  gold: "bg-gold-100 text-gold-700",
};

export function Badge({
  variant = "neutral",
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

/**
 * Honest state badges. Never invent states — render only what the data says.
 */
export const StateBadges = {
  job: (state: string) => {
    const map: Record<string, { variant: BadgeVariant; label: string }> = {
      created: { variant: "neutral", label: "Criada" },
      queued: { variant: "info", label: "Na fila" },
      running: { variant: "active", label: "Em execução" },
      waiting_approval: { variant: "warning", label: "Aguardando aprovação" },
      approved: { variant: "success", label: "Aprovada" },
      rejected: { variant: "danger", label: "Rejeitada" },
      completed: { variant: "success", label: "Concluída" },
      failed: { variant: "danger", label: "Falhou" },
      canceled: { variant: "neutral", label: "Cancelada" },
    };
    return map[state] ?? { variant: "neutral" as BadgeVariant, label: state };
  },
  approval: (state: string) => {
    const map: Record<string, { variant: BadgeVariant; label: string }> = {
      pending: { variant: "warning", label: "Pendente" },
      approved: { variant: "success", label: "Aprovada" },
      rejected: { variant: "danger", label: "Rejeitada" },
      expired: { variant: "neutral", label: "Expirada" },
    };
    return map[state] ?? { variant: "neutral" as BadgeVariant, label: state };
  },
  integration: (state: string) => {
    const map: Record<string, { variant: BadgeVariant; label: string }> = {
      connected: { variant: "success", label: "Conectada" },
      disconnected: { variant: "neutral", label: "Desconectada" },
      error: { variant: "danger", label: "Erro" },
      testing: { variant: "info", label: "Testando…" },
    };
    return map[state] ?? { variant: "neutral" as BadgeVariant, label: state };
  },
  tool: (state: string) => {
    const map: Record<string, { variant: BadgeVariant; label: string }> = {
      active: { variant: "success", label: "Ativa" },
      inactive: { variant: "neutral", label: "Inativa" },
      draft: { variant: "gold", label: "Rascunho" },
    };
    return map[state] ?? { variant: "neutral" as BadgeVariant, label: state };
  },
};

export function StateBadge({
  kind,
  state,
  className = "",
}: {
  kind: keyof typeof StateBadges;
  state: string;
  className?: string;
}) {
  const { variant, label } = StateBadges[kind](state);
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
