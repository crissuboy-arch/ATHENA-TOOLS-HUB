/**
 * Athena Tools Hub — testes do executor HyperFrames.
 *
 * O caminho de execução é exercido de verdade (workdir isolado, lint,
 * render, ffprobe, cópia do artefacto), mas contra um CLI STUB local —
 * um script Node que imita a superfície do CLI 0.6.80 (lint --json /
 * render --output/--resolution) e gera um MP4 REAL via ffmpeg. O render
 * real do HyperFrames é provado pelo harness de demonstração
 * (scripts/demo-first-execution.ts), não pela suite unitária (26 s por
 * render + Chromium).
 */
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedDimensions,
  resolveCliCommand,
  runHyperFramesJob,
} from "./hyperframes-executor";

const STUB_SOURCE = `
import { spawnSync } from "node:child_process";
const [cmd, dir, ...rest] = process.argv.slice(2);
if (cmd === "lint") {
  if (process.env.STUB_LINT_FAIL === "1") {
    console.log(JSON.stringify({ ok: false, errors: ["stub: composição inválida"] }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}
if (cmd === "render") {
  let out = "final.mp4";
  let res = "portrait";
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--output") out = rest[i + 1];
    if (rest[i] === "--resolution") res = rest[i + 1];
  }
  const dims = { portrait: "1080x1920", square: "1080x1080", landscape: "1920x1080" }[res] || "1080x1920";
  const size = process.env.STUB_WRONG_DIMS === "1" ? "640x480" : dims;
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x0F172A:s=" + size + ":d=1", "-pix_fmt", "yuv420p", out], { cwd: process.cwd() });
  process.exit(r.status ?? 1);
}
console.log("stub: comando desconhecido " + cmd);
process.exit(2);
`;

async function makeStub(): Promise<{ stubPath: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hf-stub-"));
  const stubPath = path.join(root, "stub-hyperframes.mjs");
  await writeFile(stubPath, STUB_SOURCE, "utf8");
  return { stubPath, root };
}

function makeCtx(params: Record<string, unknown>, progress: number[] = []) {
  return {
    jobId: "job-exec-test",
    orgId: "org-exec-test",
    toolId: "hyperframes",
    params,
    missionId: null,
    attempt: 1,
    maxAttempts: 1,
    signal: new AbortController().signal,
    reportProgress: async (pct: number) => {
      progress.push(pct);
    },
  };
}

const validParams = {
  composition: { html: "<div data-composition-id='x'>olá</div>" },
  format: "9:16" as const,
  quality: "draft" as const,
};

describe("resolveCliCommand / expectedDimensions (puros)", () => {
  it("HYPERFRAMES_CLI aponta para cli.js via node", () => {
    const cmd = resolveCliCommand({ HYPERFRAMES_CLI: "/opt/hf/cli.js" });
    expect(cmd).toEqual({ cmd: process.execPath, argsPrefix: ["/opt/hf/cli.js"] });
  });

  it("sem HYPERFRAMES_CLI usa o binário hyperframes do PATH", () => {
    expect(resolveCliCommand({})).toEqual({ cmd: "hyperframes", argsPrefix: [] });
  });

  it("dimensões exatas por formato", () => {
    expect(expectedDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(expectedDimensions("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(expectedDimensions("16:9")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("runHyperFramesJob com CLI stub (execução real, sem mocks no caminho)", () => {
  it("lint → render → ffprobe → artefacto copiado; workdir removido; progresso até 100", async () => {
    const { stubPath, root } = await makeStub();
    const workdirRoot = await mkdtemp(path.join(os.tmpdir(), "hf-work-"));
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "hf-art-"));
    const progress: number[] = [];
    const result = await runHyperFramesJob(makeCtx(validParams, progress), {
      env: {},
      cliCommand: { cmd: process.execPath, argsPrefix: [stubPath] },
      workdirRoot,
      artifactsDir,
    });
    expect(result.artifactPath).toBe(path.join(artifactsDir, "job-exec-test", "final.mp4"));
    expect(result.artifactBytes).toBeGreaterThan(0);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.durationSeconds).toBeCloseTo(1, 5);
    expect(result.format).toBe("9:16");
    expect(result.quality).toBe("draft");
    expect(result.resolution).toBe("portrait");
    expect(result.workdirRemoved).toBe(true);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    // Workdir isolado por job foi removido (nada hf-* restante).
    const leftovers = (await readdir(workdirRoot)).filter((n) => n.startsWith("hf-"));
    expect(leftovers).toEqual([]);
    expect(root).toBeTruthy(); // stub vive fora do workdir do job
  });

  it("lint com falha REJEITA o job (erro real, sem artefacto)", async () => {
    const { stubPath } = await makeStub();
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "hf-art-"));
    await expect(
      runHyperFramesJob(makeCtx(validParams), {
        env: { STUB_LINT_FAIL: "1" },
        cliCommand: { cmd: process.execPath, argsPrefix: [stubPath] },
        artifactsDir,
      }),
    ).rejects.toThrow(/lint/);
  });

  it("dimensões erradas no MP4 são REJEITADAS pelo ffprobe (não 'existe, logo está bom')", async () => {
    const { stubPath } = await makeStub();
    const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "hf-art-"));
    await expect(
      runHyperFramesJob(makeCtx(validParams), {
        env: { STUB_WRONG_DIMS: "1" },
        cliCommand: { cmd: process.execPath, argsPrefix: [stubPath] },
        artifactsDir,
      }),
    ).rejects.toThrow(/dimensões inesperadas/);
  });

  it("assets remotos são REJEITADOS na v1 (sem fetch arbitrário)", async () => {
    const { stubPath } = await makeStub();
    await expect(
      runHyperFramesJob(
        makeCtx({
          composition: {
            html: "<div>x</div>",
            assets: ["https://example.com/video.mp4"],
          },
        }),
        {
          env: {},
          cliCommand: { cmd: process.execPath, argsPrefix: [stubPath] },
        },
      ),
    ).rejects.toThrow(/assets remotos/);
  });

  it("docker:true sem docker no worker FALHA (sem troca de modo em silêncio)", async () => {
    const { stubPath } = await makeStub();
    await expect(
      runHyperFramesJob(makeCtx({ ...validParams, docker: true }), {
        env: {},
        cliCommand: { cmd: process.execPath, argsPrefix: [stubPath] },
        commandExists: async (name) => name !== "docker",
      }),
    ).rejects.toThrow(/docker/);
  });

  it("HYPERFRAMES_CLI inexistente FALHA antes de qualquer render", async () => {
    await expect(
      runHyperFramesJob(makeCtx(validParams), {
        env: { HYPERFRAMES_CLI: "/definitivamente/inexistente/cli.js" },
      }),
    ).rejects.toThrow(/HYPERFRAMES_CLI/);
  });
});
