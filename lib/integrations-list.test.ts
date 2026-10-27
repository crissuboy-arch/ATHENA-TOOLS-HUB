/**
 * Finalização G3 (27/10/2026): a rota GET /api/v1/integrations (nova)
 * tem de devolver a lista da org sem nunca vazar `config`, e com a
 * forma que o useApiList do dashboard entende (items/total).
 * Estes testes travam o DTO e a forma — sem rede, sem BD.
 */
import { describe, expect, it } from "vitest";
import {
  buildIntegrationsListResponse,
  toIntegrationDTO,
} from "@/app/api/v1/integrations/route";

const ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Athena",
  provider: "athena",
  type: "agent",
  state: "connected",
  config: { apiKeyHash: "NUNCA-VAZAR" },
  last_test_at: null,
  created_at: "2026-10-27T00:00:00.000Z",
  updated_at: "2026-10-27T00:00:00.000Z",
};

describe("toIntegrationDTO", () => {
  it("mapeia os campos públicos e NUNCA inclui config", () => {
    const dto = toIntegrationDTO(ROW);
    expect(dto).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Athena",
      provider: "athena",
      type: "agent",
      state: "connected",
      lastTestAt: null,
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    });
    expect("config" in dto).toBe(false);
  });

  it("state ausente vira 'unknown', nunca null", () => {
    expect(toIntegrationDTO({ ...ROW, state: undefined }).state).toBe("unknown");
  });
});

describe("buildIntegrationsListResponse", () => {
  it("expõe integrations, items (mesma lista) e total", () => {
    const dto = toIntegrationDTO(ROW);
    const res = buildIntegrationsListResponse([dto]);
    expect(res.integrations).toEqual([dto]);
    expect(res.items).toEqual([dto]);
    expect(res.total).toBe(1);
  });
});
