import * as React from "react";

export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-ink-100 bg-paper p-5 shadow-[0_1px_2px_rgba(6,15,34,0.06)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={`text-lg font-semibold text-ink-900 ${className}`} {...rest}>
      {children}
    </h2>
  );
}

export function CardDescription({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1 text-sm text-ink-500 ${className}`} {...rest}>
      {children}
    </p>
  );
}
