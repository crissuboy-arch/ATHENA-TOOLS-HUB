/**
 * Testes do callback/polling de resultado da missão.
 * `npx vitest run lib/athena/callback.test.ts`
 *
 * Cobre: construção do envelope (com request_id para rastreio),
 * emissão só em estado terminal e a falha EXPLÍCITA da entrega no MVP
 * (501 NOT_IMPLEMENTED — sem fallback silencioso).
 */
import { describe, expect, it } from "vitest";
import { HubError } from "../errors";
import type { JobAssetDTO, JobDTO } from "../jobs/service";
import {
  buildCallbackPayload,
  CALLBACK_MAX_ATTEMPTS,
  deliverCallback,
} from "./callback";
import { callbackConfigSchema } from "./contract";

const MISSION_ID = "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e";

function job(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "3f9a2c1e-5b4d-4a8f-9c2e-7d1b3f5a9c0e",
    orgId: "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a",
    toolId: "vectorcraft",
    status: "COMPLETED",
    params: {},
    idempotencyKey: MISSION_ID,
    createdBy: "integration-athena",
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:01:00.000Z",
    errorMessage: null,
    result: { ok: true },
    integrationStatus: "pending",
    startedAt: null,
    ...overrides,
  };
}

function asset(): JobAssetDTO {
  return {
    id: "a1b2c3d4-5b4d-4a8f-9c2e-7d1b3f5a9c0e",
    kind: "output_image",
    name: "logo.png",
    url: "https://cdn.exemplo.com/logo.png",
    mimeType: "image/png",
    sizeBytes: 1234,
    metadata: {},
    createdAt: "2026-10-18T12:01:00.000Z",
  };
}

describe("callbackConfigSchema", () => {
  it("aceita URL HTTPS", () => {
    const cfg = callbackConfigSchema.parse({
      url: "https://athena.exemplo.com/hooks/x",
    });
    expect(cfg.method).toBe("POST");
  });

  it("rejeita URL não-HTTPS", () => {
    expect(() =>
      callbackConfigSchema.parse({ url: "http://athena.exemplo.com/x" }),
    ).toThrow();
  });
});

describe("buildCallbackPayload", () => {
  it("constrói o envelope com request_id para rastreio", () => {
    const payload = buildCallbackPayload(
      job(),
      MISSION_ID,
      [asset()],
      "req-123",
    );
    expect(payload.event).toBe("mission.succeeded");
    expect(payload.mission_id).toBe(MISSION_ID);
    expect(payload.job_id).toBe(job().id);
    expect(payload.status).toBe("SUCCEEDED");
    expect(payload.hub_status).toBe("COMPLETED");
    expect(payload.request_id).toBe("req-123");
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0].url).toBe("https://cdn.exemplo.com/logo.png");
  });

  it("FAILED gera mission.failed com error_message", () => {
    const payload = buildCallbackPayload(
      job({ status: "FAILED", errorMessage: "executor indisponível", result: null }),
      MISSION_ID,
      [],
      "req-456",
    );
    expect(payload.event).toBe("mission.failed");
    expect(payload.error_message).toBe("executor indisponível");
  });

  it("estado não-terminal → exceção (callback só em terminal)", () => {
    expect(() =>
      buildCallbackPayload(job({ status: "RUNNING" }), MISSION_ID, [], "r"),
    ).toThrowError(/terminal/);
  });
});

describe("deliverCallback", () => {
  it("MVP: lança 501 NOT_IMPLEMENTED (explícito, sem simular entrega)", async () => {
    const payload = buildCallbackPayload(job(), MISSION_ID, [], "req-789");
    try {
      await deliverCallback("https://athena.exemplo.com/hooks/x", payload);
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("NOT_IMPLEMENTED");
      expect(hub.status).toBe(501);
    }
  });

  it("política de retry futura está documentada como constante", () => {
    expect(CALLBACK_MAX_ATTEMPTS).toBe(5);
  });
});
