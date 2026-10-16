"use client";

/**
 * Self-contained UI primitives for the workflows area (the app-wide
 * components/ui kit does not exist yet — these use only Tailwind v4
 * theme tokens from app/globals.css).
 */
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

/* ---------- page header ---------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 h-1 w-10 rounded-full bg-gold-500" aria-hidden="true" />
        <h1 className="text-2xl font-semibold text-navy-900 [.dark_&]:text-white">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-500 [.dark_&]:text-ink-300">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ---------- card ---------- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-ink-100 bg-white shadow-sm [.dark_&]:border-navy-700 [.dark_&]:bg-navy-900 ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------- alert ---------- */

const ALERT_STYLES: Record<Tone, string> = {
  info: "border-info-600 bg-info-100 text-info-600 [.dark_&]:bg-navy-800 [.dark_&]:text-navy-100",
  success:
    "border-success-600 bg-success-100 text-success-600 [.dark_&]:bg-navy-800 [.dark_&]:text-success-100",
  warning:
    "border-warning-600 bg-warning-100 text-warning-600 [.dark_&]:bg-navy-800 [.dark_&]:text-warning-100",
  danger:
    "border-danger-600 bg-danger-100 text-danger-600 [.dark_&]:bg-navy-800 [.dark_&]:text-danger-100",
  neutral:
    "border-ink-300 bg-mist text-ink-700 [.dark_&]:bg-navy-800 [.dark_&]:text-ink-100",
};

export function Alert({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div role="alert" className={`rounded-lg border-l-4 px-4 py-3 text-sm ${ALERT_STYLES[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

/* ---------- empty / loading ---------- */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mist [.dark_&]:bg-navy-800"
        aria-hidden="true"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-ink-300">
          <path
            d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-5 9-2.5-3L9 17"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8.5" cy="10.5" r="1.4" fill="currentColor" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-navy-900 [.dark_&]:text-white">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-ink-500 [.dark_&]:text-ink-300">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <Card className="flex items-center justify-center gap-3 px-6 py-14">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-ink-100 border-t-gold-500"
        aria-hidden="true"
      />
      <span className="text-sm text-ink-500 [.dark_&]:text-ink-300">{label}</span>
      <span className="sr-only">{label}</span>
    </Card>
  );
}

/* ---------- badge ---------- */

const BADGE_STYLES: Record<Tone, string> = {
  info: "bg-info-100 text-info-600",
  success: "bg-success-100 text-success-600",
  warning: "bg-warning-100 text-warning-600",
  danger: "bg-danger-100 text-danger-600",
  neutral: "bg-ink-100 text-ink-700 [.dark_&]:bg-navy-700 [.dark_&]:text-ink-100",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

/* ---------- modal ---------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl [.dark_&]:bg-navy-900"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-navy-900 [.dark_&]:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-ink-500 hover:bg-mist hover:text-ink-900 [.dark_&]:hover:bg-navy-700"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m5 5 10 10M15 5 5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div>{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------- pagination ---------- */

export function Pagination({
  page,
  perPage,
  total,
  onChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-4">
      <p className="text-sm text-ink-500 [.dark_&]:text-ink-300">
        Página {page} de {totalPages} · {total} {total === 1 ? "item" : "itens"}
      </p>
      <div className="flex gap-2">
        <Button tone="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ← Anterior
        </Button>
        <Button tone="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Próxima →
        </Button>
      </div>
    </div>
  );
}

/* ---------- tabs ---------- */

export function Tabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mb-6 flex gap-1 border-b border-ink-100 [.dark_&]:border-navy-700" role="tablist">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-gold-500 text-navy-900 [.dark_&]:text-white"
                : "border-transparent text-ink-500 hover:text-ink-900 [.dark_&]:text-ink-300 [.dark_&]:hover:text-white"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- form ---------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-ink-700 [.dark_&]:text-ink-100"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="mt-1 text-xs text-ink-500 [.dark_&]:text-ink-300">{hint}</p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-danger-600">{error}</p> : null}
    </div>
  );
}

const INPUT_CLASSES =
  "w-full rounded-lg border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-gold-500 disabled:cursor-not-allowed disabled:opacity-60 [.dark_&]:border-navy-700 [.dark_&]:bg-navy-800 [.dark_&]:text-white";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASSES} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT_CLASSES} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT_CLASSES} ${props.className ?? ""}`} />;
}

type ButtonTone = "primary" | "secondary" | "danger" | "gold";

const BUTTON_STYLES: Record<ButtonTone, string> = {
  primary:
    "bg-navy-900 text-white hover:bg-navy-800 [.dark_&]:bg-gold-500 [.dark_&]:text-navy-950 [.dark_&]:hover:bg-gold-400",
  secondary:
    "border border-ink-100 bg-white text-ink-700 hover:bg-mist [.dark_&]:border-navy-700 [.dark_&]:bg-navy-800 [.dark_&]:text-ink-100 [.dark_&]:hover:bg-navy-700",
  danger: "bg-danger-600 text-white hover:brightness-110",
  gold: "bg-gold-500 text-navy-950 hover:bg-gold-400",
};

export function Button({
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[tone]} ${className}`}
    />
  );
}

/* ---------- copy button ---------- */

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-500 hover:bg-mist hover:text-ink-900 [.dark_&]:text-ink-300 [.dark_&]:hover:bg-navy-700"
      aria-live="polite"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 3 4v5A1.5 1.5 0 0 0 4.5 10.5H5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      {copied ? "Copiado!" : label}
    </button>
  );
}

/* ---------- table ---------- */

export const table = {
  wrapper: "overflow-x-auto",
  table: "w-full text-sm",
  thead: "border-b border-ink-100 text-left [.dark_&]:border-navy-700",
  th: "px-4 py-3 text-xs font-semibold tracking-wide text-ink-500 uppercase [.dark_&]:text-ink-300",
  tbody: "divide-y divide-ink-100 [.dark_&]:divide-navy-700",
  td: "px-4 py-3 text-ink-900 [.dark_&]:text-ink-100",
  rowClickable: "cursor-pointer transition-colors hover:bg-mist [.dark_&]:hover:bg-navy-800",
};

/* ---------- JSON viewer ---------- */

export function JsonViewer({ value, maxHeight = "max-h-96" }: { value: unknown; maxHeight?: string }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <pre
      className={`overflow-auto rounded-lg bg-navy-950 p-4 font-mono text-xs leading-relaxed text-navy-100 ${maxHeight}`}
    >
      {text}
    </pre>
  );
}
