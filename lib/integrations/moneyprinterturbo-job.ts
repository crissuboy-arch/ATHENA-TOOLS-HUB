/**
 * Athena-side preparation for a MoneyPrinterTurbo job.
 *
 * This ONLY validates and normalizes an already-authorized request. It does
 * NOT submit anything to MPT, does NOT register an executor, does NOT touch
 * the G3 intake, and does NOT bypass approval. Submission happens in a
 * separate step, after the G3 authorization boundary (organization + tool
 * permission + human approval) has passed — that boundary is not this file.
 */
import "server-only";

import type { VideoRequest } from "./moneyprinterturbo";

export type AthenaMptJobInput = {
  organizationId: string;
  toolSlug: string;
  authorizedBy: string;
  authorizedAt: string;
  idempotencyKey?: string;
  videoRequest: VideoRequest;
};

export type AthenaMptJob = {
  jobId: string;
  idempotencyKey: string;
  organizationId: string;
  toolSlug: "moneyprinterturbo";
  authorizedBy: string;
  authorizedAt: string;
  videoRequest: VideoRequest;
  status: "authorized-not-submitted";
};

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function prepareAuthorizedMptJob(input: AthenaMptJobInput): AthenaMptJob {
  if (!nonBlank(input.organizationId)) {
    throw new Error("Job Athena exige organização.");
  }
  if (input.toolSlug !== "moneyprinterturbo") {
    throw new Error("Ferramenta não autorizada para este caminho.");
  }
  if (!nonBlank(input.authorizedBy)) {
    throw new Error("Job Athena exige quem autorizou a execução.");
  }
  if (!nonBlank(input.authorizedAt) || Number.isNaN(Date.parse(input.authorizedAt))) {
    throw new Error("Job Athena exige data de autorização válida.");
  }
  if (!nonBlank(input.videoRequest?.video_subject)) {
    throw new Error("Assunto obrigatório.");
  }
  const jobId = globalThis.crypto.randomUUID();
  return {
    jobId,
    idempotencyKey: nonBlank(input.idempotencyKey)
      ? input.idempotencyKey!.trim()
      : jobId,
    organizationId: input.organizationId.trim(),
    toolSlug: "moneyprinterturbo",
    authorizedBy: input.authorizedBy.trim(),
    authorizedAt: input.authorizedAt,
    videoRequest: input.videoRequest,
    status: "authorized-not-submitted",
  };
}
