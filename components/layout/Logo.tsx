import * as React from "react";

/** Brand mark: gold "A" on navy, matching /icons/icon.svg. */
export function Logo({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Athena Tools Hub"
      className={className}
    >
      <defs>
        <linearGradient id="ath-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0A1A33" />
          <stop offset="1" stopColor="#060F22" />
        </linearGradient>
        <linearGradient id="ath-logo-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E3CC85" />
          <stop offset="1" stopColor="#C6A15B" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#ath-logo-bg)" />
      <path
        d="M256 128 L384 384 H336 L305 300 H207 L176 384 H128 Z M256 196 L229 268 H283 Z"
        fill="url(#ath-logo-gold)"
      />
    </svg>
  );
}
