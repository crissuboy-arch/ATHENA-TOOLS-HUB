/**
 * Athena Tools Hub — adapter HyperFrames (honestidade + contrato real).
 *
 * Regras duras: o adapter NUNCA simula sucesso de execução e NUNCA anuncia
 * geração de avatares de IA como capacidade nativa. `execute()` lança
 * NOT_IMPLEMENTED (501); o render real é desenhado para worker isolado via
 * `buildRenderJobSpec()` (contrato confirmado do CLI: lint → check →
 * render). Sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest";
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

describe("HyperFramesAdapter.execute — honestidade", () => {
  it("execute() LANÇA NOT_IMPLEMENTED (501), nunca simula sucesso", async () => {
    try {
      await adapter.execute();
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("NOT_IMPLEMENTED");
      expect(hub.status).toBe(501);
    }
  });

  it("executionReady é false — nenhum worker de renderização conectado", () => {
    expect(adapter.executionReady).toBe(false);
  });

  it("id, version e capabilities do contrato (sem avatares de IA)", () => {
    expect(adapter.id).toBe("hyperframes");
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

  it("aplica defaults (formato 9:16, quality delivery)", () => {
    const r = adapter.validateParams({
      composition: { html: "<div>x</div>" },
    });
    expect(r.ok).toBe(true);
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

  it("rejeita quality inválida", () => {
    const r = adapter.validateParams({
      composition: { html: "<div>x</div>" },
      quality: "cinema",
    });
    expect(r.ok).toBe(false);
  });
});

describe("buildRenderJobSpec — contrato do worker isolado", () => {
  it("monta a sequência lint → check → render do CLI real", () => {
    const spec = buildRenderJobSpec(validParams, "0.6.80");
    expect(spec.mustRunOn).toBe("isolated-worker");
    expect(spec.runner).toBe("npx");
    expect(spec.package).toBe("hyperframes@0.6.80");
    expect(spec.commands.map((c) => c.cmd)).toEqual(["lint", "check", "render"]);
    const render = spec.commands[2]!;
    expect(render.args).toContain("--output");
    expect(render.args).toContain("final.mp4");
    expect(render.args).toContain("--docker");
  });

  it("sem docker: omite a flag --docker", () => {
    const spec = buildRenderJobSpec({ ...validParams, docker: false });
    expect(spec.commands[2]!.args).not.toContain("--docker");
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
  it("exige aprovação (renderização externa pode gerar custo)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});
