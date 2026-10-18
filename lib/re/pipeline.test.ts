/**
 * Testes end-to-end do pipeline (lib/re/pipeline.ts):
 * upload → validação → job → sandbox → relatório → artefactos.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HARD_CEILINGS } from "./config";
import { analyzeArtifact } from "./pipeline";
import type { AnalyzeInput } from "./types";
import {
  eicarBytes,
  jsBytes,
  peBytes,
  textBytes,
  zipBytes,
} from "./test-utils";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const input = (over: Partial<AnalyzeInput> = {}): AnalyzeInput => ({
  filename: "nota.txt",
  bytes: textBytes("Relatório de análise\nlinha dois\n"),
  analysisType: "Análise de arquivo / binário",
  authorized: true,
  ...over,
});

describe("analyzeArtifact — caminho feliz", () => {
  it("analisa um texto e devolve relatório + 3 artefactos", async () => {
    const out = await analyzeArtifact(input());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.job.status).toBe("COMPLETED");
    expect(out.job.events.length).toBeGreaterThanOrEqual(4);
    expect(out.report.kind).toBe("text");
    expect(out.report.sha256).toBe(sha256(input().bytes));
    expect(out.report.engine).toEqual({ id: "static-local", status: "READY", isolated: true });
    expect(out.report.clamped).toEqual([]);
    expect(out.artifacts.map((a) => a.name).sort()).toEqual(
      ["manifest.json", "report.json", "strings.txt"].sort(),
    );
    for (const a of out.artifacts) {
      expect(a.sha256).toBe(sha256(new TextEncoder().encode(a.content)));
      expect(a.sizeBytes).toBeGreaterThan(0);
    }
    // strings.txt contém o conteúdo textual
    const strings = out.artifacts.find((a) => a.name === "strings.txt")!;
    expect(strings.content).toContain("Relatório de análise");
  });

  it("extrai dependências de um ZIP com package.json", async () => {
    const pkg = JSON.stringify({ dependencies: { react: "^19.0.0" }, devDependencies: { vitest: "^3.0.0" } });
    const out = await analyzeArtifact(
      input({
        filename: "pacote.zip",
        bytes: zipBytes([
          { name: "package.json", data: pkg },
          { name: "index.js", data: "console.log(1)" },
        ]),
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.kind).toBe("zip");
    expect(out.report.structure.zip_entries).toBe(2);
    expect(out.report.dependencies).toContain("npm:react");
    expect(out.report.dependencies).toContain("npm(dev):vitest");
  });

  it("extrai imports de JavaScript", async () => {
    const out = await analyzeArtifact(input({ filename: "app.js", bytes: jsBytes() }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.kind).toBe("javascript");
    expect(out.report.dependencies).toContain("react");
    expect(out.report.dependencies).toContain("node:fs");
  });

  it("transições de job seguem a ordem válida", async () => {
    const out = await analyzeArtifact(input());
    if (!out.ok) return;
    const seq = out.job.events.map((e) => `${e.from}→${e.to}`);
    expect(seq).toEqual([
      "RECEIVED→VALIDATING",
      "VALIDATING→QUEUED",
      "QUEUED→RUNNING",
      "RUNNING→COMPLETED",
    ]);
  });

  it("reporta overrides clampados no relatório", async () => {
    const out = await analyzeArtifact(input(), { limits: { timeoutMs: 999_999_999 } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.report.clamped).toContain("timeoutMs");
    expect(out.report.limitsApplied.timeoutMs).toBe(HARD_CEILINGS.timeoutMs);
  });
});

describe("analyzeArtifact — quarentena e falhas", () => {
  it("quarentena EICAR: rejeitado, nunca executado", async () => {
    const out = await analyzeArtifact(input({ filename: "teste.txt", bytes: eicarBytes() }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rejection.code).toBe("MALWARE_SIGNATURE");
    expect(out.rejection.quarantine).toBe(true);
    expect(out.job.status).toBe("REJECTED");
  });

  it("rejeita spoofing de extensão", async () => {
    const out = await analyzeArtifact(input({ filename: "foto.png", bytes: peBytes() }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rejection.code).toBe("EXTENSION_SPOOF");
    expect(out.job.status).toBe("REJECTED");
  });

  it("rejeita sem autorização", async () => {
    const out = await analyzeArtifact(input({ authorized: false }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rejection.code).toBe("AUTHORIZATION_REQUIRED");
  });

  it("falha com timeout curto (sandbox real)", async () => {
    const out = await analyzeArtifact(input(), { limits: { timeoutMs: 1 } });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // 1ms pode matar antes ou durante o arranque do node — ambos são falha honesta
    expect(["SANDBOX_TIMEOUT", "ANALYSIS_FAILED"]).toContain(out.rejection.code);
    expect(out.job.status).toBe("FAILED");
  }, 15_000);
});
