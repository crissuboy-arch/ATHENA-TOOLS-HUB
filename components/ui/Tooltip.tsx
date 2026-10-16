"use client";

import * as React from "react";

/**
 * Simple CSS tooltip: appears on hover/focus, no JS state.
 */
export function Tooltip({
  label,
  children,
  position = "top",
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={`group/tooltip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-navy-950 px-2.5 py-1 text-xs font-medium text-paper opacity-0 shadow-lg transition-opacity group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${
          position === "top" ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
