/**
 * Testes do contrato ATHENA ↔ HUB (puro, sem I/O).
 * `npx vitest run lib/athena/contract.test.ts`
 *
 * Cobre: validação do payload (válido/inválido), resolução de
 * requires_human_approval (incl. 409 em divergência), preservação do
 * mission_id como idempotencyKey e os helpers de MissionStatus.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import {
  isMissionStatus,
  isTerminalMissionStatus,
  missionStatuses,
  missionToJobInput,
  parseMission,
  resolveRequiresApproval,
  terminalMissionStatuses,
  toolRequiresApproval,
} from "./contract";

const ORG_ID = "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a";
const MISSION_ID = "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e";

function validMission(overrides: Record<string, unknown> = {}) {
  return {
    mission_id: MISSION_ID,
    tool_id: "vectorcraft",
    org_id: ORG_ID,
    params: { prompt: "logo minimalista de cafeteria", width: 1024 },
    ...overrides,
  };
}

describe("parseMission", () => {
  it("aceita um payload completo e válido", () => {
    const m = parseMission(
      validMission({
        requires_human_approval: true,
        callback: { url: "https://athena.exemplo.com/hooks/x" },
        priority: 80,
        tags: ["ofensiva-criativa"],
        expires_at: "2030-01-01T00:00:00.000Z",
      }),
    );
    expect(m.mission_id).toBe(MISSION_ID);
    expect(m.tool_id).toBe("vectorcraft");
    expect(m.priority).toBe(80);
    expect(m.callback?.url).toBe("https://athena.exemplo.com/hooks/x");
  });

  it("aplica defaults (priority 50, tags [])", () => {
    const m = parseMission(validMission());
    expect(m.priority).toBe(50);
    expect(m.tags).toEqual([]);
    expect(m.requires_human_approval).toBeUndefined();
  });

  it("rejeita mission_id inválido (400 VALIDATION)", () => {
    try {
      parseMission(validMission({ mission_id: "nao-um-uuid" }));
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("VALIDATION");
      expect((err as HubError).status).toBe(400);
    }
  });

  it("rejeita payload sem tool_id", () => {
    const { tool_id: _toolId, ...rest } = validMission();
    void _toolId;
    expect(() => parseMission(rest)).toThrowError(HubError);
  });

  it("rejeita callback sem HTTPS", () => {
    try {
      parseMission(validMission({ callback: { url: "http://inseguro.test/x" } }));
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect((err as HubError).code).toBe("VALIDATION");
    }
  });

  it("rejeita expires_at no passado", () => {
    try {
      parseMission(validMission({ expires_at: "2020-01-01T00:00:00.000Z" }));
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect((err as HubError).code).toBe("VALIDATION");
    }
  });

  it("rejeita corpo não-objeto", () => {
    expect(() => parseMission(null)).toThrowError(HubError);
    expect(() => parseMission("texto")).toThrowError(HubError);
  });
});

describe("requires_human_approval", () => {
  it("tool com adapter que exige aprovação → true", () => {
    expect(toolRequiresApproval("vectorcraft")).toBe(true);
  });

  it("tool desconhecida → exige aprovação (padrão seguro)", () => {
    expect(toolRequiresApproval("tool-que-nao-existe")).toBe(true);
  });

  it("pedido consistente com o contrato é aceite", () => {
    expect(resolveRequiresApproval("vectorcraft", true)).toBe(true);
    expect(resolveRequiresApproval("vectorcraft", undefined)).toBe(true);
  });

  it("pedido divergente do contrato → 409 CONFLICT (sem ajuste silencioso)", () => {
    try {
      resolveRequiresApproval("vectorcraft", false);
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("CONFLICT");
      expect(hub.status).toBe(409);
    }
  });

  it("tool desconhecida + pedido false → 409 (padrão seguro não é contornado)", () => {
    expect(() =>
      resolveRequiresApproval("tool-que-nao-existe", false),
    ).toThrowError(HubError);
  });
});

describe("missionToJobInput", () => {
  it("preserva mission_id como idempotencyKey (idempotência)", () => {
    const m = parseMission(validMission());
    const input = missionToJobInput(m, ORG_ID);
    expect(input.idempotencyKey).toBe(MISSION_ID);
    expect(input.orgId).toBe(ORG_ID);
    expect(input.toolId).toBe("vectorcraft");
    expect(input.params).toEqual({
      prompt: "logo minimalista de cafeteria",
      width: 1024,
    });
  });

  it("mesma missão → mesmo input (determinístico)", () => {
    const a = missionToJobInput(parseMission(validMission()), ORG_ID);
    const b = missionToJobInput(parseMission(validMission()), ORG_ID);
    expect(a).toEqual(b);
  });
});

describe("examples/athena-mission.json", () => {
  it("o exemplo é um payload válido", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(
      join(__dirname, "..", "..", "examples", "athena-mission.json"),
      "utf8",
    );
    const m = parseMission(JSON.parse(raw));
    expect(m.mission_id).toBe("9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e");
    // Consistência: o exemplo pede aprovação e a tool exige aprovação.
    expect(resolveRequiresApproval(m.tool_id, m.requires_human_approval)).toBe(
      true,
    );
  });
});
describe("MissionStatus", () => {
  it("expõe os 8 estados", () => {
    expect(missionStatuses).toHaveLength(8);
  });

  it("terminais: SUCCEEDED, FAILED, CANCELLED", () => {
    expect([...terminalMissionStatuses].sort()).toEqual(
      ["CANCELLED", "FAILED", "SUCCEEDED"].sort(),
    );
    expect(isTerminalMissionStatus("SUCCEEDED")).toBe(true);
    expect(isTerminalMissionStatus("RUNNING")).toBe(false);
  });

  it("isMissionStatus estreita strings válidas e rejeita o resto", () => {
    expect(isMissionStatus("AWAITING_APPROVAL")).toBe(true);
    expect(isMissionStatus("COMPLETED")).toBe(false); // vocabulário do Hub, não Athena
    expect(isMissionStatus("BOGUS")).toBe(false);
    expect(isMissionStatus(null)).toBe(false);
  });
});
