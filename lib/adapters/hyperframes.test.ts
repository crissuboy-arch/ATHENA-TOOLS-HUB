/**
 * Athena Tools Hub — adapter HyperFrames (contrato real + executor ligado).
 *
 * Regras duras: o adapter NUNCA simula sucesso de execução e NUNCA anuncia
 * geração de avatares de IA como capacidade nativa. `execute()` corre o
 * render real (lint → render → ffprobe) via import dinâmico do executor;
 * sem pré-requisitos, falha com erro real. O contrato aqui provado é o do
 * CLI 0.6.80: lint → render (NÃO existe `check`), quality
 * draft|standard|high, docker false por omissão. Sem rede, sem Supabase.
 */
import { describe, expect, it, afterEach } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import {
  buildRenderJobSpec,
  FORMAT_RESOLUTION_PRESET,
  HyperFramesAdapter,
  resolveHyperFramesVersion,
} from "./hyperframes";

const adapter = new HyperFramesAdapter();

const validParams = {
  composition: { html: "<div data-composition-id='x'>olá</div>" },
  format: "9:16" as const,
  durationSeconds: 15,
};

/** Restaura o env manipulado por cada teste de gate. */
const savedWorkerEnabled = process.env["HYPERFRAMES_WORKER_ENABLED"];
const savedCli = process.env["HYPERFRAMES_CLI"];
afterEach(() => {
  if (savedWorkerEnabled === undefined) delete process.env["HYPERFRAMES_WORKER_ENABLED"];
  else process.env["HYPERFRAMES_WORKER_ENABLED"] = savedWorkerEnabled;
  if (savedCli === undefined) delete process.env["HYPERFRAMES_CLI"];
  else process.env["HYPERFRAMES_CLI"] = savedCli;
});

describe("HyperFramesAdapter.execute — execução real, sem simulação", () => {
  it("execute() com params inválidos LANÇA erro de validação (nunca simula)", async () => {
    await expect(
      adapter.execute({
        jobId: "job-test",
        orgId: "org-test",
        toolId: "hyperframes",
        params: { format: "9:16" },
        missionId: null,
        attempt: 1,
        maxAttempts: 1,
        signal: new AbortController().signal,
        reportProgress: async () => {},
      }),
    ).rejects.toBeInstanceOf(HubError);
  });

  it("execute() sem CLI configurado FALHA com erro real (nunca sucesso falso)", async () => {
    process.env["HYPERFRAMES_CLI"] = "/definitivamente/inexistente/cli.js";
    await expect(
      adapter.execute({
        jobId: "job-test",
        orgId: "org-test",
        toolId: "hyperframes",
        params: validParams,
        missionId: null,
        attempt: 1,
        maxAttempts: 1,
        signal: new AbortController().signal,
        reportProgress: async () => {},
      }),
    ).rejects.toThrow(/HYPERFRAMES_CLI/);
  });

  it("executionReady é false sem HYPERFRAMES_WORKER_ENABLED=1", () => {
    delete process.env["HYPERFRAMES_WORKER_ENABLED"];
    expect(new HyperFramesAdapter().executionReady).toBe(false);
  });

  it("executionReady é true SÓ com HYPERFRAMES_WORKER_ENABLED=1 (opt-in do worker)", () => {
    process.env["HYPERFRAMES_WORKER_ENABLED"] = "1";
    expect(new HyperFramesAdapter().executionReady).toBe(true);
    process.env["HYPERFRAMES_WORKER_ENABLED"] = "0";
    expect(new HyperFramesAdapter().executionReady).toBe(false);
  });

  it("id, version e capabilities do contrato (sem avatares de IA)", () => {
    expect(adapter.id).toBe("hyperframes");
    expect(adapter.version).toBe("0.3.0-worker");
    expect(adapter.capabilities).toContain("video.render");
    expect(adapter.capabilities.join(" ")).not.toMatch(/avatar/i);
  });

  it("está registrado no registry global", () => {
    expect(toolRegistry.get("hyperframes")).toBeDefined();
  });
});

describe("HyperFramesAdapter.validateParams (contrato real)", () => {
  it("aceita composição HTML válida", () => {
    const r = adapter.validateParams(validParams);
    expect(r.ok).toBe(true);
  });

  it("aplica defaults (formato 9:16, quality standard)", () => {
    const spec = buildRenderJobSpec({ composition: { html: "<div>x</div>" } });
    expect(spec.commands[1]!.args).toContain("standard");
  });

  it("rejeita formato inválido", () => {
    const r = adapter.validateParams({
      composition: { html: "<div>x</div>" },
      format: "21:9",
    });
    expect(r.ok).toBe(false);
  });

  it("rejeita sem HTML de composição", () => {
    const r = adapter.validateParams({ format: "1:1" });
    expect(r.ok).toBe(false);
  });

  it("rejeita quality inválida — incluindo os valores antigos looks/delivery", () => {
    for (const quality of ["cinema", "looks", "delivery"]) {
      const r = adapter.validateParams({
        composition: { html: "<div>x</div>" },
        quality,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("aceita quality draft|standard|high", () => {
    for (const quality of ["draft", "standard", "high"]) {
      expect(
        adapter.validateParams({ composition: { html: "<div>x</div>" }, quality }).ok,
      ).toBe(true);
    }
  });
});

describe("buildRenderJobSpec — contrato do worker isolado", () => {
  it("monta a sequência lint → render do CLI real 0.6.80 (sem check)", () => {
    const spec = buildRenderJobSpec(validParams, "0.6.80");
    expect(spec.mustRunOn).toBe("isolated-worker");
    expect(spec.runner).toBe("hyperframes-cli");
    expect(spec.package).toBe("hyperframes@0.6.80");
    expect(spec.commands.map((c) => c.cmd)).toEqual(["lint", "render"]);
    const render = spec.commands[1]!;
    expect(render.args).toContain("--output");
    expect(render.args).toContain("final.mp4");
    expect(render.args).toContain("--resolution");
    expect(render.args).toContain("portrait");
    expect(render.args).toContain("--workers");
    expect(render.args).not.toContain("--docker");
    expect(render.args).not.toContain("--json");
  });

  it("com docker: true inclui a flag --docker (e exige docker no worker)", () => {
    const spec = buildRenderJobSpec({ ...validParams, docker: true });
    expect(spec.commands[1]!.args).toContain("--docker");
  });

  it("mapeia formato → preset de resolução documentado", () => {
    expect(FORMAT_RESOLUTION_PRESET["9:16"]).toBe("portrait");
    expect(FORMAT_RESOLUTION_PRESET["1:1"]).toBe("square");
    expect(FORMAT_RESOLUTION_PRESET["16:9"]).toBe("landscape");
    const spec = buildRenderJobSpec(validParams);
    expect(spec.requirements.join(" ")).toMatch(/portrait/);
  });

  it("desliga update checks no worker", () => {
    const spec = buildRenderJobSpec(validParams);
    expect(spec.env["HYPERFRAMES_NO_UPDATE_CHECK"]).toBe("1");
  });

  it("conta os bytes do HTML da composição", () => {
    const spec = buildRenderJobSpec(validParams);
    expect(spec.compositionHtmlBytes).toBeGreaterThan(0);
  });
});

describe("resolveHyperFramesVersion", () => {
  it("default 0.6.80 (versão endurecida no MKVideos)", () => {
    expect(resolveHyperFramesVersion({})).toBe("0.6.80");
  });

  it("respeita HYPERFRAMES_VERSION", () => {
    expect(
      resolveHyperFramesVersion({ HYPERFRAMES_VERSION: "0.7.1" }),
    ).toBe("0.7.1");
  });
});

describe("HyperFramesAdapter.dryRunInfo — honestidade", () => {
  it("exige aprovação (renderização externa pode gerar custo de infra)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });

  it("não declara custo: executor v1 é só render local $0 (nunca cloud)", () => {
    expect(adapter.dryRunInfo().estimatedCost).toBeUndefined();
  });
});
