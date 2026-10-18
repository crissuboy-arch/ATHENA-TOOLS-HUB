/**
 * Athena Tools Hub — FASE 5: deteção de formato por magic bytes.
 *
 * A extensão do ficheiro NUNCA é confiável: o tipo real é determinado pelos
 * primeiros bytes (fonte única: lib/re/worker/signatures.json, partilhada com o
 * worker isolado). Texto é detetado por sniffing (proporção de bytes
 * imprimíveis + marcador inicial).
 */

import signatures from "./worker/signatures.json";
import type { ReFileKind } from "./types";

interface SignatureEntry {
  kind: string;
  mime: string;
  extensions: string[];
  magicHex?: string;
  offset?: number;
  sniff?: "json" | "xml" | "html" | "text";
  note?: string;
}

const SIGNATURES = signatures as SignatureEntry[];

/** Extensões aceites por kind (usado na verificação anti-spoofing). */
export function extensionsFor(kind: ReFileKind): readonly string[] {
  const found = SIGNATURES.filter((s) => s.kind === kind).flatMap((s) => s.extensions);
  return [...new Set(found)];
}

/** MIME canónico do kind detetado. */
export function mimeFor(kind: ReFileKind): string {
  const found = SIGNATURES.find((s) => s.kind === kind);
  return found?.mime ?? "application/octet-stream";
}

function matchesMagic(bytes: Uint8Array, hex: string, offset: number): boolean {
  if (bytes.length < offset + hex.length / 2) return false;
  for (let i = 0; i < hex.length; i += 2) {
    const expected = parseInt(hex.slice(i, i + 2), 16);
    if (bytes[offset + i / 2] !== expected) return false;
  }
  return true;
}

function isTextual(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.length === 0) return false;
  let bad = 0;
  for (const b of sample) {
    // NUL ou controlos fora de \t \n \r → binário
    if (b === 0x00 || (b < 0x09) || (b >= 0x0e && b < 0x20 && b !== 0x1b)) {
      if (b !== 0x09 && b !== 0x0a && b !== 0x0d) bad++;
    }
  }
  return bad / sample.length < 0.05;
}

function sniffTextKind(bytes: Uint8Array): ReFileKind {
  const head = Buffer.from(bytes.subarray(0, 512)).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("<")) {
    return head.includes("<html") ? "html" : "xml";
  }
  return "text";
}

/**
 * Deteta o formato real dos bytes. Retorna "unknown" quando nenhum magic
 * bytes nem sniffing de texto corresponde.
 */
export function detectKind(bytes: Uint8Array): ReFileKind | "unknown" {
  // Magic binários primeiro (match mais longo primeiro para desempate).
  const binary = SIGNATURES.filter((s) => s.magicHex).sort(
    (a, b) => (b.magicHex?.length ?? 0) - (a.magicHex?.length ?? 0),
  );
  for (const sig of binary) {
    if (matchesMagic(bytes, sig.magicHex as string, sig.offset ?? 0)) {
      return sig.kind as ReFileKind;
    }
  }
  if (isTextual(bytes)) return sniffTextKind(bytes);
  return "unknown";
}
