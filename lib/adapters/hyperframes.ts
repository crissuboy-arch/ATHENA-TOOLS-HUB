/**
 * Athena Tools Hub — adapter HyperFrames (contrato + executor real, worker-only).
 *
 * LICENÇA CONFIRMADA: Apache-2.0 (github.com/heygen-com/hyperframes;
 * verificado via API do GitHub em 2026-10-18). Uso comercial permitido,
 * sem custo por render, sem limite de tamanho de equipa.
 * Docs oficiais do CLI: https://hyperframes.heygen.com/packages/cli
 *
 * O QUE O HYPERFRAMES É (contrato real, provado contra o CLI 0.6.80
 * instalado em 2026-10-28 — NÃO contra docs mais recentes):
 * renderização determinística de composições HTML/CSS/animação → MP4,
 * via headless Chromium (puppeteer-core) + FFmpeg. Pipeline do CLI:
 *   `hyperframes lint . --json`
 *   → `hyperframes render . --output final.mp4
 *        --quality draft|standard|high
 *        --resolution portrait|square|landscape --workers 1`
 * Correções ao contrato antigo (que estava errado): NÃO existe `check`
 * na 0.6.80 (imprime a ajuda e sai 0); `--quality` NÃO aceita
 * looks/delivery; `--docker` é false por omissão; `render` NÃO tem
 * `--json`; a resolução TEM de ser passada explicitamente.
 *
 * BROWSER (prova 2026-10-28): o Chromium do sistema (/opt/meta-chromium,
 * 152) bloqueia a navegação loopback do próprio CLI com
 * ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS — nem wrapper com
 * --disable-features=LocalNetworkAccessChecks resolveu. O Chrome for
 * Testing do Playwright (chromium-1248, 156.0.8078.4) rendeu à primeira
 * (1080×1920, 3 s, ffprobe OK). A imagem do worker USA Chrome for
 * Testing; nunca o chromium 152.
 *
 * REQUISITOS: Node.js ≥ 22, FFmpeg + ffprobe, Chromium headless.
 * Render é PESADO — este adapter SÓ executa no worker isolado, nunca no
 * frontend nem no servidor principal. `execute()` faz import dinâmico
 * do executor (node:*) para nada disso entrar no bundle web.
 *
 * GATE DE ATIVAÇÃO: `executionReady` é true SÓ quando
 * HYPERFRAMES_WORKER_ENABLED=1 — variável que existe APENAS no ambiente
 * do worker. NUNCA definir na Vercel (o Preview continua a mostrar
 * "pending" sem worker a correr).
 *
 * CUSTO: render local $0 (Apache-2.0). O executor v1 NUNCA chama
 * cloud/lambda/cloudrun — por isso `estimatedCost` é undefined e a
 * trava de custo do worker (allowPaidExecution=false) NÃO bloqueia este
 * executor. Se um dia houver modo pago, o custo volta a ser declarado.
 *
 * Este adapter NÃO anuncia geração de avatares de IA como capacidade
 * nativa — essa nunca foi uma função do HyperFrames.
 */

import { z } from "zod";
import type { ExecutionContext } from "../jobs/worker";
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

/** Formato → preset --resolution do CLI (documentado + provado). */
export const FORMAT_RESOLUTION_PRESET = {
  "9:16": "portrait", // 1080×1920
  "1:1": "square", // 1080×1080
  "16:9": "landscape", // 1920×1080
} as const;

export type HyperFramesFormat = keyof typeof FORMAT_RESOLUTION_PRESET;

/** Params aceitos pelo contrato real do HyperFrames. */
export const hyperFramesParamsSchema = z
  .object({
    composition: z.object({
      /** HTML da composição (com data-* de timing e class="clip"). */
      html: z.string().min(1, "HTML da composição é obrigatório.").max(2_000_000),
      /**
       * URLs de media referenciados pela composição. Declarar é válido,
       * mas o executor v1 REJEITA assets não vazios (não faz fetch de
       * URLs — só HTML autocontido).
       */
      assets: z.array(z.string().url()).max(20).optional(),
    }),
    format: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
    /** Duração alvo em segundos (o HTML define o timing real). */
    durationSeconds: z.number().int().min(1).max(600).optional(),
    /** Qualidade real do CLI 0.6.80 (default do CLI: standard). */
    quality: z.enum(["draft", "standard", "high"]).default("standard"),
    /**
     * Render em contentor. Default false (worker local); true exige
     * docker presente no worker, senão o job FALHA (sem troca de modo
     * em silêncio).
     */
    docker: z.boolean().default(false),
    /** Dados tipados passados via --variables (window.__hyperframes.getVariables()). */
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type HyperFramesParams = z.infer<typeof hyperFramesParamsSchema>;

/**
 * Especificação pura do job de render para o worker isolado.
 * O worker executa: lint → render no diretório da composição.
 * Sem I/O aqui — só construção do spec.
 */
export interface HyperFramesRenderJobSpec {
  /** Onde DEVE correr: worker isolado, nunca frontend/servidor principal. */
  mustRunOn: "isolated-worker";
  runner: "hyperframes-cli";
  package: string;
  version: string;
  /** Sequência de comandos do CLI real (o worker cria o diretório antes). */
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
  // Normaliza defaults do contrato (docker: false, quality: standard…).
  const params = hyperFramesParamsSchema.parse(rawParams);
  const preset = FORMAT_RESOLUTION_PRESET[params.format];
  const renderArgs = [
    "render",
    ".",
    "--output",
    "final.mp4",
    "--quality",
    params.quality,
    "--resolution",
    preset,
    "--workers",
    "1",
  ];
  if (params.variables) renderArgs.push("--variables", JSON.stringify(params.variables));
  if (params.docker) renderArgs.push("--docker");

  return {
    mustRunOn: "isolated-worker",
    runner: "hyperframes-cli",
    package: `hyperframes@${version}`,
    version,
    commands: [
      { cmd: "lint", args: [".", "--json"] },
      { cmd: "render", args: renderArgs },
    ],
    requirements: [
      "node>=22",
      "ffmpeg + ffprobe instalados no worker",
      "chromium headless via HYPERFRAMES_BROWSER_PATH (Chrome for Testing; nunca chromium 152)",
      `preset de resolução: ${preset} (formato ${params.format})`,
    ],
    env: {
      // Sem checks de update, prompts ou telemetria em CI/worker.
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_SKIP_SKILLS: "1",
      HYPERFRAMES_NO_TELEMETRY: "1",
    },
    compositionHtmlBytes: Buffer.byteLength(params.composition.html, "utf8"),
  };
}

export class HyperFramesAdapter implements ToolContract {
  readonly id = "hyperframes";
  readonly version = "0.3.0-worker";
  readonly capabilities = ["video.render"];

  /**
   * True SÓ com worker ligado (opt-in explícito do ambiente do worker).
   * Nunca definir HYPERFRAMES_WORKER_ENABLED=1 na Vercel.
   */
  get executionReady(): boolean {
    return process.env["HYPERFRAMES_WORKER_ENABLED"] === "1";
  }

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
      // Render local pode gerar custo de infraestrutura — exige aprovação.
      requiresApproval: true,
      // Sem custo estimado: o executor v1 só corre render local ($0,
      // Apache-2.0) e nunca chama modos cloud — a trava de custo do
      // worker não bloqueia este executor.
      estimatedCost: undefined,
    };
  }

  /**
   * Renderização REAL via worker isolado (lint → render → ffprobe →
   * artefacto). Import dinâmico: o código node:* do executor nunca
   * entra no bundle do servidor web — só corre quando o Worker o chama.
   */
  async execute(ctx: ExecutionContext): Promise<unknown> {
    const { runHyperFramesJob } = await import("./hyperframes-executor");
    return runHyperFramesJob(ctx);
  }
}

/** Registra o adapter no registry global. Importar este módulo = registrar. */
toolRegistry.register(new HyperFramesAdapter());
