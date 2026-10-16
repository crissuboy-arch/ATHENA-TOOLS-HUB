"use client";

import { JOB_STATE_LABELS, type JobState } from "@/lib/workflow-models";
import { Badge, type Tone } from "@/components/workflows-ui";

const STATE_TONES: Record<JobState, Tone> = {
  CREATED: "neutral",
  VALIDATING: "info",
  PENDING_APPROVAL: "warning",
  QUEUED: "info",
  RUNNING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

/** Colored pt-BR badge for a job state. */
export default function JobStateBadge({ state }: { state: JobState }) {
  return <Badge tone={STATE_TONES[state] ?? "neutral"}>{JOB_STATE_LABELS[state] ?? state}</Badge>;
}
