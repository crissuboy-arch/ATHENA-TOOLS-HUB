/**
 * Testes do worker de análise estática (lib/re/worker/analyze.mjs),
 * executado via sandbox real — valida o contrato WorkerReport por formato.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runIsolated } from "./sandbox";
import type { SandboxLimits } from "./sandbox";
import type { WorkerReport } from "./types";
import {
  elfBytes,
  jsonBytes,
  machoBytes,
  peBytes,
  pdfBytes,
  pngBytes,
  textBytes,
} from "./test-utils";

const LIMITS: SandboxLimits = {
  timeoutMs: 15_000,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxCpuSeconds: 15,
  maxDiskBytes: 50 * 1024 * 1024,
};

const WORKER_DIR = fileURLToPath(new URL("./worker/", import.meta.url));

async function analyze(bytes: Uint8Array, kindHint?: string): Promise<WorkerReport> {
  const [workerSrc, sigSrc] = await Promise.all([
    readFile(`${WORKER_DIR}/analyze.mjs`, "utf8"),
    readFile(`${WORKER_DIR}/signatures.json`, "utf8"),
  ]);
  const r = await runIsolated({
    script: { name: "analyze.mjs", content: workerSrc },
    extraFiles: [{ name: "signatures.json", content: sigSrc }],
    inputFiles: [
      { name: "input.bin", content: bytes },
      {
        name: "limits.json",
        content: JSON.stringify({
          maxStrings: 5000,
          minStringLength: 4,
          maxStringsBytes: 1024 * 1024,
          maxExtractedBytes: 10 * 1024 * 1024,
          kindHint,
        }),
      },
    ],
    args: ["input.bin", "report.json", "limits.json"],
    outputFiles: ["report.json"],
    limits: LIMITS,
  });
  expect(r.ok).toBe(true);
  const raw = r.files["report.json"];
  expect(raw).toBeDefined();
  return JSON.parse(raw!.toString("utf8")) as WorkerReport;
}

describe("worker analyze.mjs", () => {
  it("reporta sha256, entropia e strings de um texto", async () => {
    const rep = await analyze(textBytes("hello sandbox world\n"));
    expect(rep.kind).toBe("text");
    expect(rep.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rep.entropy).toBeGreaterThan(0);
    expect(rep.entropy).toBeLessThanOrEqual(8);
    expect(rep.strings.total).toBeGreaterThan(0);
    expect(rep.strings.sample.join(" ")).toContain("hello sandbox world");
  });

  it("extrai estrutura de PE (x86-64, 3 secções)", async () => {
    const rep = await analyze(peBytes());
    expect(rep.kind).toBe("pe");
    expect(rep.structure.pe_machine).toBe("x86-64");
    expect(rep.structure.pe_sections).toBe(3);
    expect(rep.structure.pe_is_executable).toBe(true);
  });

  it("extrai estrutura de ELF (64-bit, x86-64, EXEC)", async () => {
    const rep = await analyze(elfBytes());
    expect(rep.kind).toBe("elf");
    expect(rep.structure.elf_class).toBe("64-bit");
    expect(rep.structure.elf_machine).toBe("x86-64");
    expect(rep.structure.elf_type).toBe("executable");
  });

  it("extrai estrutura de Mach-O", async () => {
    const rep = await analyze(machoBytes());
    expect(rep.kind).toBe("macho");
    expect(rep.structure.macho_cpu).toBe("x86-64");
    expect(rep.structure.macho_filetype).toBe("execute");
    expect(rep.structure.macho_64bit).toBe(true);
  });

  it("extrai dimensões de PNG", async () => {
    const rep = await analyze(pngBytes());
    expect(rep.kind).toBe("png");
    expect(rep.structure.png_width).toBe(64);
    expect(rep.structure.png_height).toBe(32);
  });

  it("extrai versão de PDF", async () => {
    const rep = await analyze(pdfBytes());
    expect(rep.kind).toBe("pdf");
    expect(rep.structure.pdf_version).toBe("1.7");
  });

  it("valida JSON e resume estrutura", async () => {
    const rep = await analyze(jsonBytes());
    expect(rep.kind).toBe("json");
    expect(rep.structure.json_valid).toBe(true);
    expect(rep.structure.json_type).toBe("object");
    expect(rep.structure.json_keys).toBe(3);
  });

  it("marca JSON inválido com warning", async () => {
    const rep = await analyze(textBytes("{invalid json,,"));
    expect(rep.kind).toBe("json");
    expect(rep.structure.json_valid).toBe(false);
    expect(rep.warnings.length).toBeGreaterThan(0);
  });

  it("sinaliza entropia alta (>7.2)", async () => {
    // bytes pseudoaleatórios determinísticos (LCG)
    const b = new Uint8Array(4096);
    let s = 12345;
    for (let i = 0; i < b.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      b[i] = (s >> 16) & 0xff;
    }
    const rep = await analyze(b);
    expect(rep.entropy).toBeGreaterThan(7.2);
    expect(rep.metadata.high_entropy).toBe(true);
  });
});
