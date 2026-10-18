/**
 * Athena Tools Hub — adapter HyperFrames (contract-first, worker-only).
 *
 * LICENÇA CONFIRMADA: Apache-2.0 (github.com/heygen-com/hyperframes;
 * verificado via API do GitHub em 2026-10-18). Uso comercial permitido,
 * sem custo por render, sem limite de tamanho de equipa.
 * Docs oficiais do CLI: https://hyperframes.heygen.com/packages/cli
 *
 * O QUE O HYPERFRAMES É (contrato real, não inventado):
 * renderização determinística de composições HTML/CSS/animação → MP4,
 * via headless Chromium (puppeteer-core) + FFmpeg. Pipeline do CLI:
 *   `hyperframes init <dir> --non-interactive`
 *   → `hyperframes lint` (contrato da composição: data-composition-id,
 *      data-start/data-duration, class="clip")
 *   → `hyperframes check` (executa a página headless, deteta erros)
 *   → `hyperframes render --output final.mp4
 *        [--quality draft|looks|delivery] [--docker]`
 * Alternativas de escala: `lambda render`, `cloudrun render`, `cloud render`.
 *
 * REQUISITOS (documentados): Node.js ≥ 22, FFmpeg instalado, Chromium
 * headless. Render é PESADO — este adapter é DESENHADO PARA WORKER
 * ISOLADO: nunca executa no frontend nem no servidor principal.
 * `buildRenderJobSpec()` produz a especificação pura que o worker executa;
 * `execute()` lança 501 até o worker estar ligado — nenhuma execução
 * simulada.
 *
 * Este adapter NÃO anuncia geração de avatares de IA como capacidade
 * nativa — essa nunca foi uma função do HyperFrames.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/**
 * Versão pinada do pacote HyperFrames. Default 0.6.80 — a mesma versão
 * endurecida no MKVideos (convenção HYPERFRAMES_VERSION; não subir sem
 * render de validação).
 */
export function resolveHyperFramesVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  const v = (env["HYPERFRAMES_VERSION"] ?? "").trim();
  return v || "0.6.80";
}

/** Formato → preset --resolution do CLI (documentado). */
export const FORMAT_RESOLUTION_PRESET = {
  "9:16": "portrait", // 1080×1920
  "1:1": "square", // 1080×1080
  "16:9": "landscape", // 1920×1080
} as const;

export type HyperFramesFormat = keyof typeof FORMAT_RESOLUTION_PRESET;

/** Params aceitos pelo contrato real do HyperFrames. */
const hyperFramesParamsSchema = z
  .object({
    composition: z.object({
      /** HTML da composição (com data-* de timing e class="clip"). */
      html: z.string().min(1, "HTML da composição é obrigatório.").max(2_000_000),
      /** URLs de media referenciados pela composição (o worker resolve). */
      assets: z.array(z.string().url()).max(20).optional(),
    }),
    format: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
    /** Duração alvo em segundos (o HTML define o timing real). */
    durationSeconds: z.number().int().min(1).max(600).optional(),
    quality: z.enum(["draft", "looks", "delivery"]).default("delivery"),
    /** Render reproduzível em contentor (recomendado no worker). */
    docker: z.boolean().default(true),
    /** Dados tipados expostos como window.__hfVariables no render. */
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type HyperFramesParams = z.infer<typeof hyperFramesParamsSchema>;

/**
 * Especificação pura do job de render para o worker isolado.
 * O worker executa: npx hyperframes@<versão> lint/check/render no
 * diretório da composição. Sem I/O aqui — só construção do spec.
 */
export interface HyperFramesRenderJobSpec {
  /** Onde DEVE correr: worker isolado, nunca frontend/servidor principal. */
  mustRunOn: "isolated-worker";
  runner: "npx";
  package: string;
  version: string;
  /** Sequência de comandos do CLI real (init é feito antes, pelo worker). */
  commands: Array<{ cmd: string; args: string[] }>;
  requirements: string[];
  env: Record<string, string>;
  /** O HTML é escrito pelo worker num ficheiro index.html temporário. */
  compositionHtmlBytes: number;
}

export function buildRenderJobSpec(
  rawParams: z.input<typeof hyperFramesParamsSchema>,
  version: string = resolveHyperFramesVersion(),
): HyperFramesRenderJobSpec {
  // Normaliza defaults do contrato (docker: true, quality: delivery…).
  const params = hyperFramesParamsSchema.parse(rawParams);
  const preset = FORMAT_RESOLUTION_PRESET[params.format];
  const renderArgs = [
    "render",
    "--output",
    "final.mp4",
    "--quality",
    params.quality,
    "--json",
  ];
  if (params.docker) renderArgs.push("--docker");

  return {
    mustRunOn: "isolated-worker",
    runner: "npx",
    package: `hyperframes@${version}`,
    version,
    commands: [
      { cmd: "lint", args: ["--json"] },
      { cmd: "check", args: ["--json"] },
      { cmd: "render", args: renderArgs },
    ],
    requirements: [
      "node>=22",
      "ffmpeg instalado no worker",
      "chromium headless (via puppeteer-core)",
      `preset de resolução: ${preset} (formato ${params.format})`,
    ],
    env: {
      // Sem checks de update nem prompts em CI/worker.
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_SKIP_SKILLS: "1",
    },
    compositionHtmlBytes: Buffer.byteLength(params.composition.html, "utf8"),
  };
}

export class HyperFramesAdapter implements ToolContract {
  readonly id = "hyperframes";
  readonly version = "0.2.0-contract";
  readonly capabilities = ["video.render"];
  /** Nenhum worker de renderização conectado — estado honesto. */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = hyperFramesParamsSchema.safeParse(params);
    if (result.success) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "params"}: ${i.message}`,
      ),
    };
  }

  dryRunInfo(): DryRunInfo {
    return {
      // Render externa pode gerar custo de infraestrutura — exige aprovação.
      requiresApproval: true,
      estimatedCost:
        "render local: sem custo por render (licença Apache-2.0); " +
        "cloud/lambda/cloudrun: conforme o provedor",
    };
  }

  /**
   * Renderização real — AINDA NÃO LIGADA.
   * O render acontece num worker isolado via buildRenderJobSpec().
   * Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "render HyperFrames acontece num worker isolado (ver buildRenderJobSpec " +
        "e docs/VIDEO_CONNECTORS.md) — nenhuma execução simulada",
    );
  }
}

/** Registra o adapter no registry global. Importar este módulo = registrar. */
toolRegistry.register(new HyperFramesAdapter());
