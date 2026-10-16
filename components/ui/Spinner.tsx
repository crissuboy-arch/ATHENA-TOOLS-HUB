import * as React from "react";

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
} as const;

export function Spinner({
  size = "md",
  className = "",
  label = "Carregando…",
}: {
  size?: keyof typeof sizeClasses;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block animate-spin rounded-full border-current border-t-transparent ${sizeClasses[size]} ${className}`}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
