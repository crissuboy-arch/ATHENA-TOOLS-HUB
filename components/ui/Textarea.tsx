import * as React from "react";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, id, className = "", ...rest }, ref) {
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
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`block w-full rounded-lg border border-ink-100 bg-paper px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-300 transition-colors focus:border-gold-500 focus:outline-none disabled:bg-mist disabled:cursor-not-allowed ${
            error ? "border-danger-600" : ""
          }`}
          {...rest}
        />
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);
