"use client";

import * as React from "react";

type AlertVariant = "success" | "warning" | "danger" | "info";

const variantClasses: Record<AlertVariant, string> = {
  success: "border-success-600/30 bg-success-100 text-success-600",
  warning: "border-warning-600/30 bg-warning-100 text-warning-600",
  danger: "border-danger-600/30 bg-danger-100 text-danger-600",
  info: "border-info-600/30 bg-info-100 text-info-600",
};

export function Alert({
  variant = "info",
  title,
  children,
  onDismiss,
  className = "",
}: {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${variantClasses[variant]} ${className}`}
    >
      <div className="flex-1">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar"
          className="rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}
