import type { ToolState } from "@/lib/catalog/types";
import { TOOL_STATE_LABELS } from "@/lib/catalog/types";

/**
 * Honest state badge. Colors only signal maturity — they never claim a tool
 * works. "Operacional (testado)" is reserved for states proven by a real test.
 */
const STYLES: Record<ToolState, string> = {
  cataloged: "bg-info-100 text-info-600",
  "needs-config": "bg-warning-100 text-warning-600",
  "in-development": "bg-gold-100 text-gold-700",
  connected: "bg-navy-100 text-navy-700",
  "operational-tested": "bg-success-100 text-success-600",
  error: "bg-danger-100 text-danger-600",
  unavailable: "bg-ink-100 text-ink-500",
};

export default function StateBadge({
  state,
  className = "",
}: {
  state: ToolState;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[state]} ${className}`}
    >
      {TOOL_STATE_LABELS[state]}
    </span>
  );
}
