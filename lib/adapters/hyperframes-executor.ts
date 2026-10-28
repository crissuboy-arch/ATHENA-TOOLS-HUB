/**
 * Athena Tools Hub — executor HyperFrames (worker isolado, execução real).
 *
 * Este módulo corre SOMENTE no worker (Node). Nunca é importado
 * estaticamente pelo adapter (o adapter faz import dinâmico dentro de
 * execute()), para nenhum `node:*` entrar no bundle do servidor web.
 *
 * Pipeline real do CLI 0.6.80 (provada contra o pacote instalado, não
 * contra docs mais recentes):
 *   lint . --json
 *   → render . --output final.mp4 --quality draft|standard|high
 *        --resolution portrait|square|landscape --workers 1
 *        [--variables '<json>'] [--docker]
 * NÃO existe `check` na 0.6.80 (imprime a ajuda e sai 0) — a sequência
 * antiga lint → check → render estava errada e foi corrigida aqui.
 *
 * Limites honestos da v1:
 * - Só HTML autocontido: `composition.assets` não vazio é rejeitado
 *   (o worker NÃO faz fetch arbitrário de URLs).
 * - Só render local: nunca `--docker`, cloud, lambda ou cloudrun, salvo
 *   `docker: true` explícito no job E docker presente no worker — nesse
 *   caso, sem docker, o job FALHA (nunca troca de modo em silêncio).
 * - Sem custo: licença Apache-2.0, render local $0. Por isso o adapter
 *   declara `estimatedCost: undefined` — a trava de custo do worker
 *   (allowPaidExecution=false) NÃO bloqueia este executor.
 *
 * Browser: o CLI usa HYPERFRAMES_BROWSER_PATH quando definido. PROVADO
 * 2026-10-28: o Chromium do sistema (/opt/meta-chromium, 152) bloqueia
 * a navegação loopback do próprio CLI com
 * ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS — nem o wrapper com
 * --disable-features=LocalNetworkAccessChecks resolveu. O Chrome for
 * Testing do Playwright (chromium-1248, 156.0.8078.4) rendeu à primeira.
 * A imagem do worker USA Chrome for Testing; nunca o chromium 152.
 */

import { spawn } from "node:child_process";
import { access, copyFile, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HubError } from "../errors";
import type { ExecutionContext } from "../jobs/worker";
import {
  FORMAT_RESOLUTION_PRESET,
  hyperFramesParamsSchema,
  resolveHyperFramesVersion,
  type HyperFramesParams,
} from "./hyperframes";

/** Resultado real de um render — o artefacto é um ficheiro, não JSON. */
export interface HyperFramesExecutionResult {
  artifactPath: string;
  artifactBytes: number;
  width: number;
  height: number;
  durationSeconds: number;
  format: string;
  quality: string;
  resolution: string;
  renderSeconds: number;
  workdirRemoved: true;
}

/** Dimensões exatas de cada preset --resolution do CLI 0.6.80. */
export const RESOLUTION_DIMENSIONS = {
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
} as const;

export function expectedDimensions(
  format: keyof typeof FORMAT_RESOLUTION_PRESET,
): { width: number; height: number } {
  return RESOLUTION_DIMENSIONS[FORMAT_RESOLUTION_PRESET[format]];
}

/** Resolução do CLI: HYPERFRAMES_CLI (caminho p/ cli.js) ou `hyperframes` no PATH. */
export function resolveCliCommand(
  env: Record<string, string | undefined>,
): { cmd: string; argsPrefix: string[] } {
  const cliPath = (env["HYPERFRAMES_CLI"] ?? "").trim();
  if (cliPath) return { cmd: process.execPath, argsPrefix: [cliPath] };
  return { cmd: "hyperframes", argsPrefix: [] };
}

export interface ExecutorOverrides {
  env?: Record<string, string | undefined>;
  /** Substitui a resolução do CLI (testes: stub local). */
  cliCommand?: { cmd: string; argsPrefix: string[] };
  /** Substitui a deteção de comandos no PATH (testes). */
  commandExists?: (name: string) => Promise<boolean>;
  /** Versão do Node a validar (testes). Default: process.versions.node. */
  nodeVersion?: string;
  workdirRoot?: string;
  artifactsDir?: string;
}

async function defaultCommandExists(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v ${name}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0 && out.trim().length > 0));
  });
}

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

const OUTPUT_CAP = 200_000;

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined>; signal: AbortSignal },
): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      signal: opts.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += d.toString().slice(0, OUTPUT_CAP - stdout.length);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += d.toString().slice(0, OUTPUT_CAP - stderr.length);
    });
    child.on("error", (err) => {
      reject(
        new Error(
          `HyperFrames: falha ao lançar "${cmd} ${args.join(" ")}": ${err.message}`,
        ),
      );
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function lastLines(text: string, n = 6): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" | ");
}

/** Extrai JSON de uma saída que pode trazer decoração do CLI. */
function parseCliJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function checkPrerequisites(
  params: HyperFramesParams,
  env: Record<string, string | undefined>,
  o: Required<Pick<ExecutorOverrides, "commandExists">> & ExecutorOverrides,
): Promise<void> {
  const nodeMajor = Number.parseInt((o.nodeVersion ?? process.versions.node).split(".")[0] ?? "0", 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(
      `HyperFrames: Node ${o.nodeVersion ?? process.versions.node} insuficiente — o worker exige Node >= 22.`,
    );
  }
  // CLI explícito primeiro: é a configuração do operador — falha rápida e
  // determinística mesmo sem ffmpeg no ambiente de testes.
  const cliPathSet = (env["HYPERFRAMES_CLI"] ?? "").trim();
  if (cliPathSet) {
    try {
      await stat(cliPathSet);
    } catch {
      throw new Error(
        `HyperFrames: HYPERFRAMES_CLI aponta para ficheiro inexistente: ${cliPathSet}`,
      );
    }
  }
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (!(await o.commandExists(tool))) {
      throw new Error(`HyperFrames: "${tool}" não encontrado no PATH do worker.`);
    }
  }
  const cli = o.cliCommand ?? resolveCliCommand(env);
  // Override explícito (testes/stub) dispensa a verificação de PATH.
  if (!cliPathSet && !o.cliCommand && !(await o.commandExists(cli.cmd))) {
    throw new Error(
      `HyperFrames: CLI "hyperframes" não encontrado no PATH e HYPERFRAMES_CLI não definido.`,
    );
  }
  const browserPath = (env["HYPERFRAMES_BROWSER_PATH"] ?? "").trim();
  if (browserPath) {
    try {
      await access(browserPath, 1); // X_OK
    } catch {
      throw new Error(
        `HyperFrames: HYPERFRAMES_BROWSER_PATH inexistente ou não executável: ${browserPath}`,
      );
    }
  }
  if (params.docker && !(await o.commandExists("docker"))) {
    throw new Error(
      `HyperFrames: job pediu docker:true mas "docker" não existe neste worker — render abortado (sem troca de modo em silêncio).`,
    );
  }
}

/**
 * Execução REAL de um job HyperFrames: lint → render → verificação por
 * ffprobe → cópia do artefacto. Lança erro real em qualquer falha; nunca
 * devolve um resultado inventado.
 */
export async function runHyperFramesJob(
  ctx: ExecutionContext,
  overrides: ExecutorOverrides = {},
): Promise<HyperFramesExecutionResult> {
  const env = overrides.env ?? process.env;
  const parsed = hyperFramesParamsSchema.safeParse(ctx.params);
  if (!parsed.success) {
    throw HubError.validation("Parâmetros HyperFrames inválidos.", {
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`),
    });
  }
  const params = parsed.data;
  if (params.composition.assets && params.composition.assets.length > 0) {
    throw HubError.validation(
      "HyperFrames v1: assets remotos não suportados — a composição tem de ser HTML autocontido (o worker não faz fetch de URLs).",
    );
  }

  const commandExists = overrides.commandExists ?? defaultCommandExists;
  await checkPrerequisites(params, env, { ...overrides, commandExists });

  const cli = overrides.cliCommand ?? resolveCliCommand(env);
  const version = resolveHyperFramesVersion(env);
  const preset = FORMAT_RESOLUTION_PRESET[params.format];
  const expected = expectedDimensions(params.format);
  const workdirRoot = overrides.workdirRoot ?? env["HYPERFRAMES_WORKDIR_ROOT"] ?? os.tmpdir();
  const artifactsDir =
    overrides.artifactsDir ??
    env["HYPERFRAMES_ARTIFACTS_DIR"] ??
    path.join(process.cwd(), "data", "hyperframes-artifacts");

  const workdir = await mkdtemp(path.join(workdirRoot, `hf-${ctx.jobId}-`));
  const report = async (pct: number): Promise<void> => {
    try {
      await ctx.reportProgress(pct);
    } catch {
      // Progresso não é crítico — nunca mascarar o resultado do render.
    }
  };
  try {
    await writeFile(path.join(workdir, "index.html"), params.composition.html, "utf8");
    await report(10);

    const childEnv: Record<string, string | undefined> = {
      ...env,
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_SKIP_SKILLS: "1",
      HYPERFRAMES_NO_TELEMETRY: "1",
    };
    // --- lint (contrato da composição; `check` NÃO existe na 0.6.80) ---
    const lint = await runCommand(cli.cmd, [...cli.argsPrefix, "lint", ".", "--json"], {
      cwd: workdir,
      env: childEnv,
      signal: ctx.signal,
    });
    if (lint.code !== 0) {
      throw new Error(
        `HyperFrames: lint falhou (exit ${lint.code}): ${lastLines(lint.stderr || lint.stdout)}`,
      );
    }
    const lintJson = parseCliJson(lint.stdout);
    if (lintJson && lintJson["ok"] === false) {
      throw new Error(
        `HyperFrames: lint rejeitou a composição: ${JSON.stringify(lintJson).slice(0, 500)}`,
      );
    }
    await report(25);

    // --- render ---
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
    await report(40);
    const startedAt = Date.now();
    const render = await runCommand(cli.cmd, [...cli.argsPrefix, ...renderArgs], {
      cwd: workdir,
      env: childEnv,
      signal: ctx.signal,
    });
    const renderSeconds = (Date.now() - startedAt) / 1000;
    if (render.code !== 0) {
      throw new Error(
        `HyperFrames: render falhou (exit ${render.code}, CLI ${version}): ${lastLines(render.stderr || render.stdout)}`,
      );
    }
    await report(85);

    // --- verificação do artefacto (ffprobe — nunca "existe, logo está bom") ---
    const mp4Path = path.join(workdir, "final.mp4");
    const info = await stat(mp4Path).catch(() => null);
    if (!info || info.size <= 0) {
      throw new Error("HyperFrames: render terminou sem produzir final.mp4 (ou vazio).");
    }
    const probe = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        mp4Path,
      ],
      { cwd: workdir, env: {}, signal: ctx.signal },
    );
    if (probe.code !== 0) {
      throw new Error(`HyperFrames: ffprobe falhou sobre final.mp4: ${lastLines(probe.stderr)}`);
    }
    const probeJson = parseCliJson(probe.stdout);
    const streams = (probeJson?.["streams"] as Array<Record<string, unknown>> | undefined) ?? [];
    const video = streams.find((s) => s["codec_type"] === "video");
    if (!video) {
      throw new Error("HyperFrames: final.mp4 não contém stream de vídeo (ffprobe).");
    }
    if (video["width"] !== expected.width || video["height"] !== expected.height) {
      throw new Error(
        `HyperFrames: dimensões inesperadas ${video["width"]}x${video["height"]} (esperado ${expected.width}x${expected.height} para ${params.format}).`,
      );
    }
    const formatJson = probeJson?.["format"] as Record<string, unknown> | undefined;
    const durationSeconds = Number.parseFloat(String(formatJson?.["duration"] ?? "0"));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("HyperFrames: duração inválida em final.mp4 (ffprobe).");
    }

    // --- persistência do artefacto (o workdir temporário é apagado) ---
    const jobDir = path.join(artifactsDir, ctx.jobId);
    await mkdir(jobDir, { recursive: true });
    const artifactPath = path.join(jobDir, "final.mp4");
    await copyFile(mp4Path, artifactPath);
    await report(100);

    return {
      artifactPath,
      artifactBytes: info.size,
      width: expected.width,
      height: expected.height,
      durationSeconds,
      format: params.format,
      quality: params.quality,
      resolution: preset,
      renderSeconds,
      workdirRemoved: true,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
