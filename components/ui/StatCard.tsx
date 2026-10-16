import * as React from "react";
import { Card } from "./Card";
import { Spinner } from "./Spinner";

export interface StatCardProps {
  title: string;
  value?: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  href?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  loading = false,
  error = false,
  errorMessage = "Indisponível",
  href,
  className = "",
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-500">{title}</p>
          <div className="mt-2 min-h-9">
            {loading ? (
              <Spinner size="sm" />
            ) : error ? (
              <p className="text-sm text-danger-600">{errorMessage}</p>
            ) : (
              <p className="text-3xl font-bold tracking-tight text-ink-900">
                {value ?? "—"}
              </p>
            )}
          </div>
        </div>
        {icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-gold-300">
            {icon}
          </div>
        )}
      </div>
      {subtitle && !error && (
        <p className="mt-2 text-xs text-ink-500">{subtitle}</p>
      )}
    </>
  );

  const cardClass = `p-5 ${href ? "transition-shadow hover:shadow-md" : ""} ${className}`;

  if (href && !loading) {
    return (
      <a href={href} aria-label={title} className="block">
        <Card className={cardClass}>{body}</Card>
      </a>
    );
  }
  return <Card className={cardClass}>{body}</Card>;
}

/** Skeleton placeholder while a stat loads — no fake numbers. */
export function StatCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <Card className={`p-5 ${className}`} aria-hidden="true">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-mist" />
        <div className="mt-3 h-8 w-16 rounded bg-mist" />
      </div>
    </Card>
  );
}
