/**
 * Athena Tools Hub — FASE 5 (engenharia reversa): API pública do módulo lib/re.
 *
 * Ponto de entrada para o motor da FASE 3 (lib/jobs) e futuros endpoints.
 * Todas as funções são puras ou orquestram o pipeline isolado; nenhuma toca
 * em app/, lib/jobs ou outros repos.
 */

export { RE_FILE_KINDS } from "./types";
export type {
  AnalyzeInput,
  AnalyzeOutcome,
  ReAnalysisType,
  ReArtifact,
  ReEngine,
  ReEngineStatus,
  ReFileKind,
  ReJob,
  ReJobEvent,
  ReJobStatus,
  ReLimits,
  ReLimitsOverride,
  ReRejection,
  ReRejectionCode,
  ReReport,
  WorkerReport,
} from "./types";

export { DEFAULT_LIMITS, HARD_CEILINGS, resolveLimits } from "./config";
export { detectKind, extensionsFor, mimeFor } from "./magic";
export { EICAR_TEST_STRING, validateArtifact } from "./validation";
export type { ValidatedFile, ValidationResult } from "./validation";
export { memoryControls, minimalEnv, runIsolated } from "./sandbox";
export type { SandboxFile, SandboxLimits, SandboxResult, SandboxRunOptions } from "./sandbox";
export { analyzeArtifact } from "./pipeline";
export { getEngine, listEngines, REA_VERIFICATION, requireReaEngine } from "./engines";
