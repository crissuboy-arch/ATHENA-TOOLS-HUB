/**
 * Testes do adaptador de vocabulário Hub ↔ Athena.
 * `npx vitest run lib/athena/adapter.test.ts`
 *
 * Cobre: mapeamento total e bijetivo nos 8 estados (ida e volta) e
 * falha EXPLÍCITA em estado desconhecido (sem aproximação silenciosa).
 */
import { describe, expect, it } from "vitest";
import { allStates } from "../jobs/machine";
import { missionStatuses } from "./contract";
import {
  adapterCoverage,
  hubStatusToMissionStatus,
  missionStatusToHubStatus,
} from "./adapter";

describe("hubStatusToMissionStatus", () => {
  it("mapeia os 8 estados do Hub para o vocabulário Athena", () => {
    expect(hubStatusToMissionStatus("CREATED")).toBe("RECEIVED");
    expect(hubStatusToMissionStatus("VALIDATING")).toBe("VALIDATING");
    expect(hubStatusToMissionStatus("PENDING_APPROVAL")).toBe("AWAITING_APPROVAL");
    expect(hubStatusToMissionStatus("QUEUED")).toBe("QUEUED");
    expect(hubStatusToMissionStatus("RUNNING")).toBe("RUNNING");
    expect(hubStatusToMissionStatus("COMPLETED")).toBe("SUCCEEDED");
    expect(hubStatusToMissionStatus("FAILED")).toBe("FAILED");
    expect(hubStatusToMissionStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("cobre todos os estados declarados em lib/jobs/machine.ts", () => {
    for (const s of allStates) {
      expect(() => hubStatusToMissionStatus(s)).not.toThrow();
    }
  });

  it("estado desconhecido → exceção explícita (sem fallback)", () => {
    expect(() => hubStatusToMissionStatus("BOGUS")).toThrowError(
      /sem mapeamento/,
    );
    expect(() => hubStatusToMissionStatus("")).toThrowError(/sem mapeamento/);
  });
});

describe("missionStatusToHubStatus", () => {
  it("tradução inversa cobre os 8 estados Athena", () => {
    expect(missionStatusToHubStatus("RECEIVED")).toBe("CREATED");
    expect(missionStatusToHubStatus("SUCCEEDED")).toBe("COMPLETED");
    expect(missionStatusToHubStatus("AWAITING_APPROVAL")).toBe("PENDING_APPROVAL");
    for (const m of missionStatuses) {
      expect(() => missionStatusToHubStatus(m)).not.toThrow();
    }
  });

  it("estado desconhecido → exceção explícita", () => {
    expect(() => missionStatusToHubStatus("COMPLETED")).toThrowError(
      /sem mapeamento/,
    ); // COMPLETED é vocabulário do Hub, não Athena
  });
});

describe("adapterCoverage", () => {
  it("mapeamento é total e bijetivo (8↔8, ida-e-volta)", () => {
    const cov = adapterCoverage();
    expect(cov.hubStates).toBe(8);
    expect(cov.missionStates).toBe(8);
    expect(cov.bijective).toBe(true);
  });
});
