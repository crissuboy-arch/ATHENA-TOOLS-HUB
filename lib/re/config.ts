/**
 * Athena Tools Hub — FASE 5: limites rígidos da análise de engenharia reversa.
 *
 * Defaults conservadores. Overrides são permitidos mas NUNCA ultrapassam os
 * tetos rígidos (HARD_CEILINGS): valores acima do teto são reduzidos
 * (clamped) e a redução é reportada de forma transparente no relatório.
 * Não existe opção para habilitar rede — análise é sempre offline.
 */

import { HubError } from "../errors";
import { RE_FILE_KINDS, type ReFileKind, type ReLimits, type ReLimitsOverride } from "./types";

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: ReLimits = {
  /** Alinhado com RE_MAX_UPLOAD_MB = 25 do catálogo (lib/catalog/tools). */
  maxUploadBytes: 25 * MB,
  /** Teto do JSON de relatório + artefactos em memória. */
  maxExtractedBytes: 10 * MB,
  /** Tempo máximo do subprocesso isolado. */
  timeoutMs: 60_000,
  /** Memória virtual máxima do subprocesso (ulimit -v). */
  maxMemoryBytes: 512 * MB,
  /** CPU máxima do subprocesso (ulimit -t). */
  maxCpuSeconds: 60,
  /** Escrita máxima em disco pelo subprocesso (ulimit -f). */
  maxDiskBytes: 100 * MB,
  /** Strings extraídas (amostra). */
  maxStrings: 5_000,
  /** Comprimento mínimo de uma string ASCII imprimível. */
  minStringLength: 4,
  /** Teto em bytes do bloco de strings no relatório. */
  maxStringsBytes: 1 * MB,
  allowedKinds: RE_FILE_KINDS,
};

/** Tetos rígidos: nenhum override pode ultrapassá-los. */
export const HARD_CEILINGS = {
  maxUploadBytes: 100 * MB,
  maxExtractedBytes: 200 * MB,
  timeoutMs: 300_000,
  maxMemoryBytes: 2 * 1024 * MB,
  maxCpuSeconds: 300,
  maxDiskBytes: 1024 * MB,
  maxStrings: 50_000,
  minStringLength: 64,
  maxStringsBytes: 10 * MB,
} as const;

type NumericLimitKey = {
  [K in keyof ReLimits]: ReLimits[K] extends number ? K : never;
}[keyof ReLimits];

const NUMERIC_KEYS = [
  "maxUploadBytes",
  "maxExtractedBytes",
  "timeoutMs",
  "maxMemoryBytes",
  "maxCpuSeconds",
  "maxDiskBytes",
  "maxStrings",
  "minStringLength",
  "maxStringsBytes",
] as const satisfies readonly NumericLimitKey[];

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw HubError.validation(
      `Limite "${name}" deve ser um inteiro positivo (recebido: ${String(value)}).`,
    );
  }
}

/**
 * Resolve os limites efetivos. Overrides inválidos lançam HubError(VALIDATION);
 * overrides acima do teto rígido são reduzidos e listados em `clamped`.
 */
export function resolveLimits(overrides?: ReLimitsOverride): {
  limits: ReLimits;
  clamped: string[];
} {
  const limits: ReLimits = {
    ...DEFAULT_LIMITS,
    allowedKinds: [...DEFAULT_LIMITS.allowedKinds],
  };
  const clamped: string[] = [];

  if (!overrides) return { limits, clamped };

  for (const key of NUMERIC_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    assertPositiveInt(key, value);
    const ceiling = HARD_CEILINGS[key];
    if (value > ceiling) {
      limits[key] = ceiling;
      clamped.push(key);
    } else {
      limits[key] = value;
    }
  }

  if (overrides.allowedKinds !== undefined) {
    const kinds = overrides.allowedKinds;
    if (kinds.length === 0) {
      throw HubError.validation("allowedKinds não pode ser vazio.");
    }
    const unknown = kinds.filter((k) => !(RE_FILE_KINDS as readonly string[]).includes(k));
    if (unknown.length > 0) {
      throw HubError.validation(
        `allowedKinds contém formatos desconhecidos: ${unknown.join(", ")}.`,
      );
    }
    limits.allowedKinds = [...kinds];
  }

  return { limits, clamped };
}

export type { ReFileKind };
