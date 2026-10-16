import * as React from "react";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, error, options, id, className = "", ...rest }, ref) {
    const inputId = id ?? React.useId();
    const errorId = `${inputId}-error`;
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
        <select
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`block w-full rounded-lg border border-ink-100 bg-paper px-3.5 py-2.5 text-sm text-ink-900 transition-colors focus:border-gold-500 focus:outline-none disabled:bg-mist disabled:cursor-not-allowed ${
            error ? "border-danger-600" : ""
          }`}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
