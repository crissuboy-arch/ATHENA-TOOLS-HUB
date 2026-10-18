/**
 * Athena Tools Hub — FASE 5: validação e quarentena de artefactos.
 *
 * Ordem rígida de verificações (a primeira falha vence):
 *   1. autorização expressa
 *   2. nome de ficheiro válido (sem path traversal)
 *   3. tamanho (não vazio, dentro do limite)
 *   4. magic bytes reconhecidos (extensão é ignorada aqui)
 *   5. formato na lista de permitidos
 *   6. consistência extensão ↔ magic bytes (anti-spoofing)
 *   7. dupla extensão suspeita (ex.: relatorio.pdf.exe)
 *   8. assinatura de teste de malware (EICAR)
 *
 * Ficheiro suspeito → quarentena: rejeitado com motivo, NUNCA executado.
 * Nenhuma mensagem de erro inclui conteúdo do ficheiro.
 */

import { createHash } from "node:crypto";
import { detectKind, extensionsFor, mimeFor } from "./magic";
import type {
  ReFileKind,
  ReLimits,
  ReRejection,
  ReRejectionCode,
} from "./types";

export interface ValidatedFile {
  kind: ReFileKind;
  mime: string;
  sizeBytes: number;
  sha256: string;
  filename: string;
}

export type ValidationResult =
  | { ok: true; file: ValidatedFile }
  | { ok: false; rejection: ReRejection };

/** String de teste padrão da indústria AV — detetar = quarentena imediata. */
export const EICAR_TEST_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const EXECUTABLE_EXTS = ["exe", "dll", "sys", "scr", "com", "bat", "cmd", "ps1", "msi"] as const;
const DOCUMENT_EXTS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "txt",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "zip",
] as const;

const JS_EXTS = ["js", "mjs", "cjs"] as const;

function reject(code: ReRejectionCode, reason: string, quarantine: boolean): ValidationResult {
  return { ok: false, rejection: { code, reason, quarantine } };
}

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : "";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkDoubleExtension(filename: string): boolean {
  const parts = filename.toLowerCase().split(".");
  if (parts.length < 3) return false; // precisa de pelo menos nome + 2 extensões
  const last = parts[parts.length - 1];
  if (!(EXECUTABLE_EXTS as readonly string[]).includes(last)) return false;
  const middle = parts.slice(1, -1);
  return middle.some((p) => (DOCUMENT_EXTS as readonly string[]).includes(p));
}

/**
 * Valida um artefacto antes de qualquer análise. Pura (sem I/O, sem exec).
 */
export function validateArtifact(
  filename: string,
  bytes: Uint8Array,
  limits: ReLimits,
  authorized: boolean,
): ValidationResult {
  if (!authorized) {
    return reject(
      "AUTHORIZATION_REQUIRED",
      "Análise rejeitada: falta declaração de autorização (artefacto próprio ou autorização expressa do titular).",
      false,
    );
  }

  const name = filename.trim();
  if (
    name.length === 0 ||
    name.length > 255 ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..")
  ) {
    return reject(
      "INVALID_FILENAME",
      "Nome de ficheiro inválido (vazio, demasiado longo ou com path traversal).",
      false,
    );
  }

  if (bytes.length === 0) {
    return reject("EMPTY_FILE", "Ficheiro vazio: nada para analisar.", false);
  }
  if (bytes.length > limits.maxUploadBytes) {
    return reject(
      "TOO_LARGE",
      `Ficheiro excede o limite de ${(limits.maxUploadBytes / 1024 / 1024).toFixed(1)}MB.`,
      false,
    );
  }

  const detected = detectKind(bytes);
  if (detected === "unknown") {
    return reject(
      "UNKNOWN_FORMAT",
      "Formato não reconhecido pelos magic bytes — ficheiro em quarentena.",
      true,
    );
  }

  if (!limits.allowedKinds.includes(detected)) {
    return reject(
      "FORMAT_NOT_ALLOWED",
      `Formato "${detected}" não está na lista de formatos permitidos — ficheiro em quarentena.`,
      true,
    );
  }

  // "text" com extensão JS é reportado como javascript (mesmo conteúdo).
  const ext = fileExtension(name);
  let kind: ReFileKind = detected;
  if (detected === "text" && (JS_EXTS as readonly string[]).includes(ext)) {
    kind = "javascript";
  }

  if (ext.length === 0) {
    return reject(
      "EXTENSION_SPOOF",
      "Ficheiro sem extensão: impossível verificar consistência com os magic bytes — quarentena.",
      true,
    );
  }
  if (!(extensionsFor(kind) as readonly string[]).includes(ext)) {
    return reject(
      "EXTENSION_SPOOF",
      `Extensão ".${ext}" inconsistente com o formato real "${kind}" detetado por magic bytes — possível spoofing, ficheiro em quarentena.`,
      true,
    );
  }

  if (checkDoubleExtension(name)) {
    return reject(
      "DOUBLE_EXTENSION",
      "Dupla extensão suspeita (documento aparente + executável real) — ficheiro em quarentena.",
      true,
    );
  }

  if (Buffer.from(bytes).toString("latin1").includes(EICAR_TEST_STRING)) {
    return reject(
      "MALWARE_SIGNATURE",
      "Assinatura de teste de malware (EICAR) detetada — ficheiro em quarentena, nunca executado.",
      true,
    );
  }

  return {
    ok: true,
    file: {
      kind,
      mime: mimeFor(kind),
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      filename: name,
    },
  };
}
