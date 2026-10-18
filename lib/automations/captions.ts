/**
 * Athena Tools Hub — preparação de legendas e roteiros (FASE 7).
 *
 * Conceito INEMA: legendas word-timed/karaoke e roteiros são a matéria-prima
 * do reel. Este módulo é 100% REAL no sentido honesto do Hub: gerar SRT/VTT
 * a partir de faixas validadas é computação pura, sem dependência externa —
 * não há nada "estrutural" aqui, o texto gerado é usável de verdade.
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";

/* ------------------------------ legendas ------------------------------ */

/** Uma faixa de legenda com tempos em milissegundos. */
export interface CaptionCue {
  inicioMs: number;
  fimMs: number;
  texto: string;
}

const cueSchema = z
  .object({
    inicioMs: z.number().int().min(0),
    fimMs: z.number().int().min(1),
    texto: z
      .string()
      .min(1, "texto da faixa é obrigatório.")
      .max(120, "máximo de 120 caracteres por faixa."),
  })
  .refine((c) => c.fimMs > c.inicioMs, {
    message: "fimMs deve ser maior que inicioMs.",
  });

const cuesSchema = z
  .array(cueSchema)
  .min(1, "é necessária ao menos 1 faixa.")
  .max(2000, "máximo de 2000 faixas.");

/** Valida faixas: formato, ordem e ausência de sobreposição. */
export function validateCues(input: unknown): AutomationResult<CaptionCue[]> {
  const parsed = cuesSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_CUES",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const cues = [...parsed.data].sort((a, b) => a.inicioMs - b.inicioMs);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].inicioMs < cues[i - 1].fimMs) {
      return automationFail(
        "OVERLAPPING_CUES",
        `Faixas sobrepostas nas posições ${i - 1} e ${i}.`,
      );
    }
  }
  return automationOk(cues);
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** ms → "HH:MM:SS,mmm" (SRT). */
export function formatSRTTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

/** ms → "HH:MM:SS.mmm" (VTT). */
export function formatVTTTime(ms: number): string {
  return formatSRTTime(ms).replace(",", ".");
}

/** Gera o conteúdo .srt a partir de faixas validadas. */
export function toSRT(input: unknown): AutomationResult<string> {
  const check = validateCues(input);
  if (!check.ok) return check as AutomationResult<string>;
  const body = check.value
    .map(
      (c, i) =>
        `${i + 1}\n${formatSRTTime(c.inicioMs)} --> ${formatSRTTime(c.fimMs)}\n${c.texto}`,
    )
    .join("\n\n");
  return automationOk(body + "\n");
}

/** Gera o conteúdo .vtt a partir de faixas validadas. */
export function toVTT(input: unknown): AutomationResult<string> {
  const check = validateCues(input);
  if (!check.ok) return check as AutomationResult<string>;
  const body = check.value
    .map(
      (c) => `${formatVTTTime(c.inicioMs)} --> ${formatVTTTime(c.fimMs)}\n${c.texto}`,
    )
    .join("\n\n");
  return automationOk("WEBVTT\n\n" + body + "\n");
}

const SRT_TIME = "(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})";
function parseTime(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1000 +
    Number(ms)
  );
}

/**
 * Lê um .srt e devolve as faixas validadas. Útil para importar legendas
 * geradas por outra ferramenta (ex.: Whisper) antes de validar no Hub.
 */
export function parseSRT(text: string): AutomationResult<CaptionCue[]> {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const cues: CaptionCue[] = [];
  const re = new RegExp(`^${SRT_TIME}\\s*-->\\s*${SRT_TIME}$`);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const timeLine = lines.find((l) => re.test(l));
    if (!timeLine) {
      return automationFail(
        "SRT_PARSE_ERROR",
        `Bloco sem linha de tempo válida: "${lines[0] ?? ""}".`,
      );
    }
    const m = timeLine.match(re)!;
    const texto = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(" ")
      .trim();
    cues.push({
      inicioMs: parseTime(m[1], m[2], m[3], m[4]),
      fimMs: parseTime(m[5], m[6], m[7], m[8]),
      texto,
    });
  }
  return validateCues(cues);
}

/* ------------------------------ roteiros ------------------------------ */

export const scriptBlockTypes = [
  "gancho",
  "desenvolvimento",
  "prova",
  "cta",
] as const;
export type ScriptBlockType = (typeof scriptBlockTypes)[number];

/** Bloco de roteiro: unidade de fala/cena com duração alvo. */
export interface ScriptBlock {
  tipo: ScriptBlockType;
  texto: string;
  /** Duração alvo em segundos. */
  duracaoSeg: number;
}

/** Roteiro completo: sequência ordenada de blocos. */
export interface Script {
  titulo: string;
  blocos: ScriptBlock[];
  /** Duração total alvo em segundos (soma dos blocos). */
  duracaoTotalSeg: number;
}

const scriptBlockSchema = z.object({
  tipo: z.enum(scriptBlockTypes),
  texto: z.string().min(1, "texto do bloco é obrigatório.").max(2000),
  duracaoSeg: z.number().int().min(1).max(600),
});

const scriptSchema = z.object({
  titulo: z.string().min(1, "título do roteiro é obrigatório.").max(200),
  blocos: z
    .array(scriptBlockSchema)
    .min(1, "roteiro precisa de ao menos 1 bloco.")
    .max(50),
});

/** Valida e calcula a duração total do roteiro. */
export function buildScript(input: unknown): AutomationResult<Script> {
  const parsed = scriptSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_SCRIPT",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const [{ titulo, blocos }] = [parsed.data];
  const hasGancho = blocos.some((b) => b.tipo === "gancho");
  const hasCta = blocos.some((b) => b.tipo === "cta");
  if (!hasGancho || !hasCta) {
    return automationFail(
      "SCRIPT_MISSING_PARTS",
      "Roteiro precisa de ao menos um bloco 'gancho' e um 'cta'.",
    );
  }
  return automationOk({
    titulo,
    blocos,
    duracaoTotalSeg: blocos.reduce((acc, b) => acc + b.duracaoSeg, 0),
  });
}

/**
 * Gera faixas de legenda a partir do roteiro, distribuindo cada bloco
 * proporcionalmente à sua duração (ponto de partida editável — não é
 * transcrição real).
 */
export function scriptToCues(
  script: Script,
  startMs = 0,
): AutomationResult<CaptionCue[]> {
  const cues: CaptionCue[] = [];
  let cursor = startMs;
  for (const bloco of script.blocos) {
    const duracaoMs = bloco.duracaoSeg * 1000;
    cues.push({
      inicioMs: cursor,
      fimMs: cursor + duracaoMs,
      texto:
        bloco.texto.length > 120
          ? bloco.texto.slice(0, 117) + "…"
          : bloco.texto,
    });
    cursor += duracaoMs;
  }
  return validateCues(cues);
}
