/**
 * Athena Tools Hub — FASE 5: execução isolada de análise.
 *
 * `runIsolated` corre um script Node (apenas o binário node atual — allowlist
 * rígida, sem shell arbitrário) dentro de um diretório temporário descartável,
 * com:
 *   - timeout (kill -9 ao expirar),
 *   - memória em duas camadas: `--max-old-space-size` (heap V8 — limite real
 *     de memória) + `ulimit -v` generoso (backstop contra reservas virtuais
 *     absurdas; um -v apertado mata o Node no arranque, verificado em teste),
 *   - CPU (`ulimit -t`) e escrita em disco (`ulimit -f`),
 *   - ambiente mínimo (PATH restrito; NENHUMA variável do processo pai —
 *     segredos nunca atravessam),
 *   - cwd = diretório descartável, stdio por pipe com teto de captura.
 *
 * Limitações honestas (ver docs/REVERSE_ENGINEERING.md):
 *   - NÃO é um namespace de rede isolado (unshare/firejail): a garantia de
 *     "sem rede" vem de o worker não conter nenhuma API de rede — verificado
 *     por teste estático (sandbox.test.ts).
 *   - Em plataformas não-POSIX, os ulimits são ignorados (só timeout).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SandboxLimits {
  timeoutMs: number;
  maxMemoryBytes: number;
  maxCpuSeconds: number;
  maxDiskBytes: number;
}

export interface SandboxFile {
  name: string;
  content: string | Uint8Array;
}

export interface SandboxRunOptions {
  /**
   * Script .mjs a executar com o node atual. É escrito DENTRO do diretório
   * descartável e corrido com cwd=esse diretório — o filho nunca toca no
   * filesystem do pai (o nome tem de terminar em .mjs).
   */
  script: SandboxFile;
  /** Ficheiros extra a copiar para o diretório descartável. */
  extraFiles?: SandboxFile[];
  /** Ficheiros de entrada (ex.: input.bin, limits.json). */
  inputFiles?: SandboxFile[];
  /** Argumentos passados ao script (argv). */
  args?: string[];
  /** Ficheiros de saída a recolher antes de descartar o diretório. */
  outputFiles?: string[];
  limits: SandboxLimits;
}

export interface SandboxResult {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Ficheiros de saída recolhidos (limitados a 10MB cada). */
  files: Record<string, Buffer>;
  /** Diretório usado (já descartado quando workDirCleaned=true). */
  workDir: string;
  workDirCleaned: boolean;
}

/** Teto de captura de stdout/stderr para não esgotar memória do pai. */
const MAX_CAPTURE_BYTES = 1 * 1024 * 1024;
/** Teto por ficheiro de saída recolhido. */
const MAX_OUTPUT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Deriva os controlos de memória a partir de maxMemoryBytes:
 *  - heapMB: `--max-old-space-size` passado ao node (limite REAL de memória);
 *  - virtualKB: `ulimit -v` (backstop; nunca abaixo de 2GB porque o V8 precisa
 *    de reserva virtual folgada no arranque — verificado empiricamente).
 */
export function memoryControls(maxMemoryBytes: number): {
  heapMB: number;
  virtualKB: number;
} {
  const heapMB = Math.max(64, Math.floor((maxMemoryBytes * 0.75) / 1048576));
  const virtualKB = Math.max(2 * 1024 * 1024, Math.ceil((maxMemoryBytes * 4) / 1024));
  return { heapMB, virtualKB };
}

/**
 * Ambiente mínimo do filho: PATH restrito + variáveis de limite.
 * O process.env do pai é DESCARTADO por inteiro (segredos nunca atravessam).
 * NODE_ENV=production é incluído por ser esperado pelo runtime (não é segredo).
 */
export function minimalEnv(limits: SandboxLimits): NodeJS.ProcessEnv {
  const { virtualKB } = memoryControls(limits.maxMemoryBytes);
  return {
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TZ: "UTC",
    NODE_ENV: "production",
    RE_SANDBOX_MEM_KB: String(virtualKB),
    RE_SANDBOX_CPU_S: String(Math.max(1, Math.floor(limits.maxCpuSeconds))),
    RE_SANDBOX_DISK_BLK: String(Math.max(1, Math.floor(limits.maxDiskBytes / 512))),
  };
}

const ULIMIT_WRAPPER = [
  'ulimit -v "${RE_SANDBOX_MEM_KB:?}" 2>/dev/null || true',
  'ulimit -t "${RE_SANDBOX_CPU_S:?}" 2>/dev/null || true',
  'ulimit -f "${RE_SANDBOX_DISK_BLK:?}" 2>/dev/null || true',
  'exec "$@"',
].join(";\n");

export async function runIsolated(opts: SandboxRunOptions): Promise<SandboxResult> {
  const startedAt = Date.now();
  const workDir = await mkdtemp(join(tmpdir(), "re-sandbox-"));

  const writeAll = async (files: SandboxFile[] | undefined) => {
    for (const f of files ?? []) {
      if (f.name.includes("/") || f.name.includes("\\") || f.name.includes("..")) {
        throw new Error(`Nome de ficheiro sandbox inválido: ${f.name}`);
      }
      await writeFile(join(workDir, f.name), f.content);
    }
  };

  let timedOut = false;
  let exitCode: number | null = null;
  let signal: string | null = null;
  let stdout = "";
  let stderr = "";
  const files: Record<string, Buffer> = {};

  try {
    await writeAll(opts.extraFiles);
    await writeAll(opts.inputFiles);
    if (!opts.script.name.endsWith(".mjs") || opts.script.name.includes("/")) {
      throw new Error(`Script sandbox inválido: ${opts.script.name}`);
    }
    await writeAll([opts.script]);

    const nodeBin = process.execPath;
    const isPosix = process.platform !== "win32";
    const { heapMB } = memoryControls(opts.limits.maxMemoryBytes);
    const nodeArgs = [`--max-old-space-size=${heapMB}`, opts.script.name, ...(opts.args ?? [])];
    const child = isPosix
      ? spawn("bash", ["-c", ULIMIT_WRAPPER, "re-sandbox", nodeBin, ...nodeArgs], {
          cwd: workDir,
          env: minimalEnv(opts.limits),
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(nodeBin, nodeArgs, {
          cwd: workDir,
          env: minimalEnv(opts.limits),
          stdio: ["ignore", "pipe", "pipe"],
        });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.limits.timeoutMs);
    // Não segurar o event loop se o chamador abandonar a promise.
    timer.unref?.();

    const append = (target: "out" | "err", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "out") {
        stdout = (stdout + text).slice(-MAX_CAPTURE_BYTES);
      } else {
        stderr = (stderr + text).slice(-MAX_CAPTURE_BYTES);
      }
    };
    child.stdout?.on("data", (c: Buffer) => append("out", c));
    child.stderr?.on("data", (c: Buffer) => append("err", c));

    await new Promise<void>((resolve) => {
      child.on("error", () => resolve());
      child.on("close", (code, sig) => {
        exitCode = code;
        signal = sig;
        resolve();
      });
    });
    clearTimeout(timer);

    // Recolher ficheiros de saída antes de descartar o diretório.
    const { readFile } = await import("node:fs/promises");
    for (const name of opts.outputFiles ?? []) {
      if (name.includes("/") || name.includes("\\") || name.includes("..")) continue;
      const p = join(workDir, name);
      if (!existsSync(p)) continue;
      const data = await readFile(p);
      files[name] = data.subarray(0, MAX_OUTPUT_FILE_BYTES);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
  }

  const workDirCleaned = !existsSync(workDir);
  return {
    ok: !timedOut && exitCode === 0,
    timedOut,
    exitCode,
    signal,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    files,
    workDir,
    workDirCleaned,
  };
}
