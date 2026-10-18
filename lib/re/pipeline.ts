/**
 * Athena Tools Hub — FASE 5: pipeline de análise de engenharia reversa.
 *
 * Fluxo: upload autorizado → validação (magic bytes, tamanho, formatos,
 * anti-spoofing, quarentena) → criação de job → execução ISOLADA (subprocesso
 * com limites, diretório descartável, sem rede) → extração estática →
 * relatório estruturado → artefactos → resultado.
 *
 * A análise é SEMPRE estática: o artefacto nunca é executado. O motor da
 * FASE 3 (lib/jobs) orquestra chamando `analyzeArtifact`; este módulo não o
 * importa.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RE_ANALYSIS_TYPES } from "../catalog/tools";
import { HubError } from "../errors";
import { resolveLimits } from "./config";
import { runIsolated } from "./sandbox";
import { RE_FILE_KINDS } from "./types";
import { validateArtifact } from "./validation";
import type {
  AnalyzeInput,
  AnalyzeOutcome,
  ReArtifact,
  ReJob,
  ReJobStatus,
  ReLimitsOverride,
  ReRejection,
  ReReport,
  WorkerReport,
} from "./types";

const WORKER_DIR = fileURLToPath(new URL("./worker/", import.meta.url));

const TRANSITIONS: Record<ReJobStatus, readonly ReJobStatus[]> = {
  RECEIVED: ["VALIDATING"],
  VALIDATING: ["QUEUED", "REJECTED"],
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
};

function newJob(input: AnalyzeInput): ReJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    filename: input.filename,
    analysisType: input.analysisType,
    status: "RECEIVED",
    createdAt: now,
    updatedAt: now,
    submittedBy: input.submittedBy,
    events: [],
  };
}

function transition(job: ReJob, to: ReJobStatus, note: string): void {
  const allowed = TRANSITIONS[job.status];
  if (!allowed.includes(to)) {
    throw HubError.invalidTransition(job.status, to);
  }
  const now = new Date().toISOString();
  job.events.push({ at: now, from: job.status, to, note });
  job.status = to;
  job.updatedAt = now;
}

function fail(job: ReJob, rejection: ReRejection): AnalyzeOutcome {
  transition(job, job.status === "VALIDATING" ? "REJECTED" : "FAILED", rejection.code);
  return { ok: false, job, rejection };
}

function isWorkerReport(v: unknown): v is WorkerReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.kind === "string" &&
    (RE_FILE_KINDS as readonly string[]).includes(r.kind) &&
    typeof r.mime === "string" &&
    typeof r.sizeBytes === "number" &&
    typeof r.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.sha256) &&
    typeof r.entropy === "number" &&
    typeof r.strings === "object" &&
    r.strings !== null &&
    typeof r.structure === "object" &&
    r.structure !== null &&
    Array.isArray(r.dependencies) &&
    typeof r.metadata === "object" &&
    r.metadata !== null &&
    Array.isArray(r.warnings)
  );
}

function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeArtifact(name: string, mime: string, content: string): ReArtifact {
  const sizeBytes = Buffer.byteLength(content, "utf8");
  return { name, mime, sizeBytes, sha256: sha256Hex(content), content };
}

/**
 * Executa o pipeline completo de análise sobre um artefacto.
 * Nunca lança por rejeição de validação/sandbox — essas voltam em `ok: false`.
 */
export async function analyzeArtifact(
  input: AnalyzeInput,
  options?: { limits?: ReLimitsOverride; jobId?: string },
): Promise<AnalyzeOutcome> {
  if (!RE_ANALYSIS_TYPES.includes(input.analysisType)) {
    throw HubError.validation(`analysisType inválido: ${String(input.analysisType)}.`);
  }

  const job = newJob(input);
  if (options?.jobId) job.id = options.jobId;

  const { limits, clamped } = resolveLimits(options?.limits);

  // 1–2. Validação (pura; ficheiro suspeito → quarentena, nada é executado).
  transition(job, "VALIDATING", "validação de formato e autorização");
  const validation = validateArtifact(input.filename, input.bytes, limits, input.authorized);
  if (!validation.ok) return fail(job, validation.rejection);
  const file = validation.file;

  transition(job, "QUEUED", `formato "${file.kind}" validado`);

  // 3. Execução isolada: worker .mjs + assinaturas copiados para dir descartável.
  let workerSrc: string;
  let sigSrc: string;
  try {
    [workerSrc, sigSrc] = await Promise.all([
      readFile(join(WORKER_DIR, "analyze.mjs"), "utf8"),
      readFile(join(WORKER_DIR, "signatures.json"), "utf8"),
    ]);
  } catch {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: "Worker de análise indisponível no servidor.",
      quarantine: false,
    });
  }

  const workerLimits = {
    maxStrings: limits.maxStrings,
    minStringLength: limits.minStringLength,
    maxStringsBytes: limits.maxStringsBytes,
    maxExtractedBytes: limits.maxExtractedBytes,
    kindHint: file.kind,
  };

  transition(job, "RUNNING", "análise estática em subprocesso isolado");
  let sandbox;
  try {
    sandbox = await runIsolated({
      script: { name: "analyze.mjs", content: workerSrc },
      extraFiles: [{ name: "signatures.json", content: sigSrc }],
      inputFiles: [
        { name: "input.bin", content: input.bytes },
        { name: "limits.json", content: JSON.stringify(workerLimits) },
      ],
      args: ["input.bin", "report.json", "limits.json"],
      outputFiles: ["report.json"],
      limits: {
        timeoutMs: limits.timeoutMs,
        maxMemoryBytes: limits.maxMemoryBytes,
        maxCpuSeconds: limits.maxCpuSeconds,
        maxDiskBytes: limits.maxDiskBytes,
      },
    });
  } catch (err) {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: `Falha ao iniciar o ambiente isolado: ${(err as Error).message.slice(0, 200)}.`,
      quarantine: false,
    });
  }

  if (sandbox.timedOut) {
    return fail(job, {
      code: "SANDBOX_TIMEOUT",
      reason:
        `Análise excedeu o tempo limite de ${(limits.timeoutMs / 1000).toFixed(0)}s — ` +
        "processo isolado terminado, diretório descartado.",
      quarantine: false,
    });
  }
  if (!sandbox.ok) {
    const excerpt = sandbox.stderr.replace(/\s+/g, " ").slice(0, 300);
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason:
        `Worker isolado terminou com erro (exit ${String(sandbox.exitCode)}, ` +
        `sinal ${String(sandbox.signal)}).${excerpt ? ` Detalhe: ${excerpt}` : ""}`,
      quarantine: false,
    });
  }

  const raw = sandbox.files["report.json"];
  if (!raw) {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: "Worker isolado não produziu relatório.",
      quarantine: false,
    });
  }

  let workerReport: WorkerReport;
  try {
    workerReport = JSON.parse(raw.toString("utf8")) as WorkerReport;
  } catch {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: "Relatório do worker isolado é JSON inválido.",
      quarantine: false,
    });
  }
  if (!isWorkerReport(workerReport)) {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: "Relatório do worker isolado viola o contrato esperado.",
      quarantine: false,
    });
  }
  // Prova de integridade: o worker analisou exatamente os bytes validados.
  if (workerReport.sha256 !== file.sha256) {
    return fail(job, {
      code: "ANALYSIS_FAILED",
      reason: "Divergência de integridade entre bytes validados e analisados.",
      quarantine: false,
    });
  }

  // 4–5. Relatório estruturado + artefactos.
  const warnings = [...workerReport.warnings];
  if (!sandbox.workDirCleaned) {
    warnings.push("sandbox: diretório temporário pode não ter sido totalmente removido");
  }
  const report: ReReport = {
    ...workerReport,
    kind: file.kind,
    mime: file.mime,
    jobId: job.id,
    filename: file.filename,
    analysisType: input.analysisType,
    generatedAt: new Date().toISOString(),
    engine: { id: "static-local", status: "READY", isolated: true },
    limitsApplied: limits,
    clamped,
    warnings,
  };

  const reportJson = JSON.stringify(report, null, 2);
  const artifacts: ReArtifact[] = [
    makeArtifact("report.json", "application/json", reportJson),
    makeArtifact("strings.txt", "text/plain", report.strings.sample.join("\n")),
    makeArtifact(
      "manifest.json",
      "application/json",
      JSON.stringify(
        {
          jobId: job.id,
          filename: file.filename,
          analysisType: input.analysisType,
          kind: file.kind,
          mime: file.mime,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          engine: report.engine,
          generatedAt: report.generatedAt,
          clamped,
          artifacts: ["report.json", "strings.txt", "manifest.json"],
        },
        null,
        2,
      ),
    ),
  ];

  transition(job, "COMPLETED", `${artifacts.length} artefactos gerados`);
  return { ok: true, job, report, artifacts };
}
