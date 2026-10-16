"use client";

import * as React from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "gold" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-navy-900 text-paper hover:bg-navy-800 active:bg-navy-950 disabled:bg-ink-300",
  gold: "bg-gold-500 text-navy-950 hover:bg-gold-400 active:bg-gold-600 disabled:bg-ink-300",
  ghost:
    "bg-transparent text-ink-700 hover:bg-navy-50 hover:text-navy-900 disabled:text-ink-300",
  danger:
    "bg-danger-600 text-paper hover:brightness-110 active:brightness-95 disabled:bg-ink-300",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:text-ink-100 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size="sm" aria-hidden />}
      {children}
    </button>
  );
}
