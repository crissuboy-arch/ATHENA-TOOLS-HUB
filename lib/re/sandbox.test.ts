/**
 * Testes do executor isolado (lib/re/sandbox.ts).
 * Executam subprocessos reais (node) — sem rede, sem dependências externas.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { memoryControls, minimalEnv, runIsolated } from "./sandbox";
import type { SandboxLimits } from "./sandbox";

const LIMITS: SandboxLimits = {
  timeoutMs: 10_000,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxCpuSeconds: 10,
  maxDiskBytes: 50 * 1024 * 1024,
};

const echo = (msg: string) => ({
  name: "echo.mjs",
  content: `console.log(${JSON.stringify(msg)});`,
});

describe("runIsolated", () => {
  it("executa script node e captura stdout", async () => {
    const r = await runIsolated({ script: echo("ola-sandbox"), limits: LIMITS });
    expect(r.ok).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("ola-sandbox");
  });

  it("termina com SIGKILL ao exceder o timeout", async () => {
    const r = await runIsolated({
      script: { name: "sleep.mjs", content: "await new Promise(r => setTimeout(r, 30000));" },
      limits: { ...LIMITS, timeoutMs: 800 },
    });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe("SIGKILL");
  });

  it("reporta exit code de script com erro", async () => {
    const r = await runIsolated({
      script: { name: "fail.mjs", content: "console.error('boom'); process.exit(3);" },
      limits: LIMITS,
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
  });

  it("não herda o ambiente do pai (segredos nunca atravessam)", async () => {
    process.env.RE_SANDBOX_PROBE_SECRET = "segredo-que-nunca-deve-vazar";
    try {
      const r = await runIsolated({
        script: { name: "env.mjs", content: "console.log(JSON.stringify(process.env));" },
        limits: LIMITS,
      });
      expect(r.ok).toBe(true);
      expect(r.stdout).not.toContain("segredo-que-nunca-deve-vazar");
      expect(r.stdout).not.toContain("RE_SANDBOX_PROBE_SECRET");
      const env = JSON.parse(r.stdout) as Record<string, string>;
      expect(env.PATH).toBe("/usr/bin:/bin");
    } finally {
      delete process.env.RE_SANDBOX_PROBE_SECRET;
    }
  });

  it("expõe as variáveis de limite lidas pelo wrapper ulimit", async () => {
    const { virtualKB } = memoryControls(LIMITS.maxMemoryBytes);
    const r = await runIsolated({
      script: {
        name: "lim.mjs",
        content:
          "console.log([process.env.RE_SANDBOX_MEM_KB, process.env.RE_SANDBOX_CPU_S, process.env.RE_SANDBOX_DISK_BLK].join(','));",
      },
      limits: LIMITS,
    });
    expect(r.stdout.trim()).toBe(
      `${virtualKB},10,${Math.floor((50 * 1024 * 1024) / 512)}`,
    );
  });

  it("aplica --max-old-space-size derivado de maxMemoryBytes", async () => {
    const { heapMB } = memoryControls(LIMITS.maxMemoryBytes);
    const r = await runIsolated({
      script: { name: "heap.mjs", content: "console.log(process.execArgv.join(' '));" },
      limits: LIMITS,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain(`--max-old-space-size=${heapMB}`);
  });

  it("memoryControls: heap 75% com mínimo 64MB; virtual com mínimo 2GB", () => {
    expect(memoryControls(512 * 1024 * 1024)).toEqual({
      heapMB: 384,
      virtualKB: 2 * 1024 * 1024,
    });
    expect(memoryControls(8 * 1024 * 1024 * 1024)).toEqual({
      heapMB: 6144,
      virtualKB: 32 * 1024 * 1024,
    });
  });

  it("descarta o diretório temporário após a execução", async () => {
    const r = await runIsolated({ script: echo("x"), limits: LIMITS });
    expect(r.workDirCleaned).toBe(true);
    expect(existsSync(r.workDir)).toBe(false);
  });

  it("recolhe ficheiros de saída antes de descartar", async () => {
    const r = await runIsolated({
      script: {
        name: "out.mjs",
        content:
          "import { writeFileSync } from 'node:fs'; writeFileSync('relatorio.txt', 'conteudo');",
      },
      outputFiles: ["relatorio.txt"],
      limits: LIMITS,
    });
    expect(r.ok).toBe(true);
    expect(r.files["relatorio.txt"]?.toString("utf8")).toBe("conteudo");
  });

  it("rejeita nome de script inválido", async () => {
    await expect(
      runIsolated({ script: { name: "../evil.mjs", content: "" }, limits: LIMITS }),
    ).rejects.toThrow();
  });
});

describe("minimalEnv", () => {
  it("contém só PATH restrito + variáveis de limite (+ NODE_ENV padrão)", () => {
    const env = minimalEnv(LIMITS);
    expect(Object.keys(env).sort()).toEqual(
      ["LANG", "NODE_ENV", "PATH", "RE_SANDBOX_CPU_S", "RE_SANDBOX_DISK_BLK", "RE_SANDBOX_MEM_KB", "TZ"].sort(),
    );
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.NODE_ENV).toBe("production");
  });
});

describe("worker analyze.mjs — auto-verificação anti-rede", () => {
  const WORKER = fileURLToPath(new URL("./worker/analyze.mjs", import.meta.url));

  it("não contém nenhuma API de rede (checagem estática)", async () => {
    const src = await readFile(WORKER, "utf8");
    const forbidden = [
      /fetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /require\(\s*['"]node:https?['"]/,
      /from\s+['"]node:https?['"]/,
      /require\(\s*['"]node:net['"]/,
      /from\s+['"]node:net['"]/,
      /require\(\s*['"]node:dns['"]/,
      /from\s+['"]node:dns['"]/,
      /require\(\s*['"]node:dgram['"]/,
      /from\s+['"]node:dgram['"]/,
    ];
    for (const re of forbidden) {
      expect(src, `worker contém padrão de rede proibido: ${re}`).not.toMatch(re);
    }
    // nem sequer menciona http (a sandbox não é um namespace de rede;
    // a garantia vem de o worker não ter como falar com a rede)
    expect(src).not.toContain("http");
  });

  it("só importa builtins seguros do node", async () => {
    const src = await readFile(WORKER, "utf8");
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const allowed = ["node:fs", "node:crypto", "node:zlib", "node:path", "node:url"];
    for (const imp of imports) {
      expect(allowed, `import inesperado no worker: ${imp}`).toContain(imp);
    }
  });
});
