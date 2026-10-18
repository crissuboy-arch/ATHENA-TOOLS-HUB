/**
 * Athena Tools Hub — conector MKVideos (honestidade do contrato).
 *
 * Regras duras: o Hub NÃO executa o pipeline MKVideos e NÃO duplica o
 * executor da Athena (Fase 7, Cláudio) — regista a ferramenta, constrói
 * envelopes CRIAR_VIDEO válidos, acompanha jobs por poll e exibe
 * artefactos. `execute()` deve lançar NOT_IMPLEMENTED (501).
 * Sem rede, sem Supabase.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import { toolRegistry } from "./index";
import {
  buildCriarVideoMission,
  isTerminalStatus,
  MISSION_ID_RE,
  MKVideosAdapter,
  newMissionId,
  toJobSnapshot,
  type MKVideosResult,
} from "./mkvideos";

const adapter = new MKVideosAdapter();

describe("MKVideosAdapter.execute — honestidade", () => {
  it("execute() LANÇA NOT_IMPLEMENTED (501), nunca simula submissão", async () => {
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

  it("executionReady é false — executor vive na Athena (Fase 7)", () => {
    expect(adapter.executionReady).toBe(false);
  });

  it("id e capabilities do contrato (sem duplicar o executor)", () => {
    expect(adapter.id).toBe("mkvideos");
    expect(adapter.capabilities).toContain("video.generate");
  });

  it("está registrado no registry global", () => {
    expect(toolRegistry.get("mkvideos")).toBeDefined();
  });
});

describe("buildCriarVideoMission — envelope CRIAR_VIDEO", () => {
  it("constrói missão válida com defaults honestos", () => {
    const r = buildCriarVideoMission(
      { objective: "Vídeo sobre o novo kit" },
      "hub-abc123",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mission.mission_type).toBe("CRIAR_VIDEO");
    expect(r.mission.mission_id).toBe("hub-abc123");
    expect(r.mission.requested_outputs).toEqual(["video"]);
    expect(r.mission.context?.video_skill).toBe("explicativo");
    expect(r.mission.context?.vertical).toBe(false);
    expect(r.mission.requires_human_approval).toBe(true);
  });

  it("aplica skill, vertical e handoff_id", () => {
    const r = buildCriarVideoMission(
      {
        objective: "Demo do produto",
        videoSkill: "demo",
        vertical: true,
        handoffId: "h-1",
      },
      "hub-demo-1",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mission.context?.video_skill).toBe("demo");
    expect(r.mission.context?.vertical).toBe(true);
    expect(r.mission.handoff_id).toBe("h-1");
  });

  it("REJEITA objective vazio", () => {
    const r = buildCriarVideoMission({ objective: "   " }, "hub-x1");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/objective/);
  });

  it("REJEITA mission_id inválido", () => {
    const r = buildCriarVideoMission({ objective: "ok" }, "!!inválido!!");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/mission_id/);
  });

  it("REJEITA skill desconhecida", () => {
    const r = buildCriarVideoMission(
      { objective: "ok", videoSkill: "cinema" as never },
      "hub-x2",
    );
    expect(r.ok).toBe(false);
  });
});

describe("newMissionId / MISSION_ID_RE", () => {
  it("gera ids válidos segundo a regra do adapter MKVideos", () => {
    for (let i = 0; i < 5; i++) {
      const id = newMissionId();
      expect(MISSION_ID_RE.test(id)).toBe(true);
    }
  });
});

describe("toJobSnapshot — acompanhamento por poll", () => {
  const base: MKVideosResult = {
    mission_id: "hub-1",
    status: "queued",
    outputs: null,
    error: null,
  };

  it("queued/running: não terminal, sem artefacto", () => {
    for (const status of ["queued", "running"] as const) {
      const s = toJobSnapshot({ ...base, status });
      expect(s.terminal).toBe(false);
      expect(s.videoPath).toBeNull();
      expect(s.error).toBeNull();
    }
  });

  it("done: terminal, com caminho do vídeo", () => {
    const s = toJobSnapshot({
      ...base,
      status: "done",
      outputs: { video: "/out/video.mp4" },
    });
    expect(s.terminal).toBe(true);
    expect(s.videoPath).toBe("/out/video.mp4");
    expect(s.error).toBeNull();
  });

  it("failed: terminal, com erro, sem artefacto", () => {
    const s = toJobSnapshot({
      ...base,
      status: "failed",
      error: "render falhou",
    });
    expect(s.terminal).toBe(true);
    expect(s.videoPath).toBeNull();
    expect(s.error).toBe("render falhou");
  });

  it("isTerminalStatus cobre done/failed", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("MKVideosAdapter.validateParams", () => {
  it("aceita params válidos", () => {
    const r = adapter.validateParams({
      objective: "Vídeo do kit",
      videoSkill: "curso",
      vertical: true,
    });
    expect(r.ok).toBe(true);
  });

  it("rejeita sem objective", () => {
    const r = adapter.validateParams({ vertical: true });
    expect(r.ok).toBe(false);
  });

  it("rejeita skill inválida", () => {
    const r = adapter.validateParams({
      objective: "x",
      videoSkill: "hollywood",
    });
    expect(r.ok).toBe(false);
  });
});

describe("MKVideosAdapter.dryRunInfo", () => {
  it("exige aprovação (geração de vídeo custa GPU/worker)", () => {
    expect(adapter.dryRunInfo().requiresApproval).toBe(true);
  });
});
