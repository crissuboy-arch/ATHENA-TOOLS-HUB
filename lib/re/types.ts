/**
 * Athena Tools Hub — FASE 5 (engenharia reversa): tipos públicos do módulo lib/re.
 *
 * O módulo expõe funções puras e bem tipadas. A orquestração com o motor de
 * jobs da FASE 3 (lib/jobs) é feita pelo chamador — este módulo nunca importa
 * lib/jobs nem código de app/.
 */

import type { RE_ANALYSIS_TYPES } from "../catalog/tools";

/** Tipos de análise oferecidos na UI (app/(app)/reverse-engineering). */
export type ReAnalysisType = (typeof RE_ANALYSIS_TYPES)[number];

/** Formatos detectáveis por magic bytes (+ sniffing para texto). */
export const RE_FILE_KINDS = [
  "zip",
  "gzip",
  "tar",
  "pdf",
  "png",
  "jpeg",
  "gif",
  "elf",
  "pe",
  "macho",
  "wasm",
  "sqlite",
  "json",
  "xml",
  "html",
  "text",
  "javascript",
] as const;
export type ReFileKind = (typeof RE_FILE_KINDS)[number];

/** Estado honesto de um motor de análise. Nunca READY sem teste real. */
export type ReEngineStatus = "READY" | "SIMULATED" | "NOT_CONFIGURED" | "FAILED";

export interface ReEngine {
  id: "static-local" | "rea";
  name: string;
  status: ReEngineStatus;
  capabilities: string[];
  requirements: string[];
  /** ISO-8601 da última verificação real; ausente quando nunca verificado. */
  lastVerifiedAt?: string;
  notes: string;
}

/** Entrada do pipeline de análise. */
export interface AnalyzeInput {
  /** Nome original do ficheiro (sem path). */
  filename: string;
  /** Conteúdo integral do ficheiro. */
  bytes: Uint8Array;
  analysisType: ReAnalysisType;
  /**
   * Declaração de autorização: true = artefacto próprio ou com autorização
   * expressa do titular. Sem isto, a análise é rejeitada antes de qualquer
   * execução.
   */
  authorized: boolean;
  submittedBy?: string;
}

export interface ReLimitsOverride {
  maxUploadBytes?: number;
  maxExtractedBytes?: number;
  timeoutMs?: number;
  maxMemoryBytes?: number;
  maxCpuSeconds?: number;
  maxDiskBytes?: number;
  maxStrings?: number;
  minStringLength?: number;
  maxStringsBytes?: number;
  allowedKinds?: readonly ReFileKind[];
}

/** Limites rígidos resolvidos (defaults conservadores + overrides clampados). */
export interface ReLimits {
  maxUploadBytes: number;
  maxExtractedBytes: number;
  timeoutMs: number;
  maxMemoryBytes: number;
  maxCpuSeconds: number;
  maxDiskBytes: number;
  maxStrings: number;
  minStringLength: number;
  maxStringsBytes: number;
  allowedKinds: readonly ReFileKind[];
  /** NOTA: não existe allowNetwork — rede é sempre proibida nesta fase. */
}

/** Relatório produzido pelo worker isolado (contrato worker → pipeline). */
export interface WorkerReport {
  kind: ReFileKind;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /** Entropia de Shannon em bits/byte (0–8). */
  entropy: number;
  strings: { total: number; truncated: boolean; sample: string[] };
  /** Estrutura específica do formato (secções, entradas, cabeçalhos…). */
  structure: Record<string, string | number | boolean | string[]>;
  /** Dependências declaradas encontradas (imports, manifestos). */
  dependencies: string[];
  metadata: Record<string, string | number | boolean>;
  warnings: string[];
}

/** Relatório final entregue ao chamador. */
export interface ReReport extends WorkerReport {
  jobId: string;
  filename: string;
  analysisType: ReAnalysisType;
  generatedAt: string;
  engine: {
    id: "static-local";
    status: Extract<ReEngineStatus, "READY">;
    isolated: boolean;
  };
  limitsApplied: ReLimits;
  /** Overrides que excederam o teto rígido e foram reduzidos. */
  clamped: string[];
  warnings: string[];
}

export interface ReArtifact {
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  /** Conteúdo em memória (limitado por maxExtractedBytes). */
  content: string;
}

export type ReJobStatus =
  | "RECEIVED"
  | "VALIDATING"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "REJECTED"
  | "FAILED";

export interface ReJobEvent {
  at: string;
  from: ReJobStatus;
  to: ReJobStatus;
  note: string;
}

export interface ReJob {
  id: string;
  filename: string;
  analysisType: ReAnalysisType;
  status: ReJobStatus;
  createdAt: string;
  updatedAt: string;
  submittedBy?: string;
  events: ReJobEvent[];
}

export type ReRejectionCode =
  | "AUTHORIZATION_REQUIRED"
  | "INVALID_FILENAME"
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "UNKNOWN_FORMAT"
  | "FORMAT_NOT_ALLOWED"
  | "EXTENSION_SPOOF"
  | "DOUBLE_EXTENSION"
  | "MALWARE_SIGNATURE"
  | "SANDBOX_TIMEOUT"
  | "ANALYSIS_FAILED";

export interface ReRejection {
  code: ReRejectionCode;
  /** Motivo legível; nunca inclui conteúdo do ficheiro. */
  reason: string;
  /** true = ficheiro foi para quarentena (nunca executado). */
  quarantine: boolean;
}

export type AnalyzeOutcome =
  | { ok: true; job: ReJob; report: ReReport; artifacts: ReArtifact[] }
  | { ok: false; job: ReJob; rejection: ReRejection };
