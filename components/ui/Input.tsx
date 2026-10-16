import * as React from "react";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const inputClass =
  "block w-full rounded-lg border border-ink-100 bg-paper px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-300 transition-colors focus:border-gold-500 focus:outline-none disabled:bg-mist disabled:text-ink-300 disabled:cursor-not-allowed";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, hint, id, className = "", ...rest }, ref) {
    const inputId = id ?? React.useId();
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    return (
      <div className={className}>
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-ink-700"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ")}
          className={`${inputClass} ${error ? "border-danger-600" : ""}`}
          {...rest}
        />
        {hint && !error && (
          <p id={hintId} className="mt-1.5 text-xs text-ink-500">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
