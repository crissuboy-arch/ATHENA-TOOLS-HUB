/**
 * Testes fail-closed da associação agente↔tool
 * (lib/athena/agent-permissions.ts). Puros, sem I/O.
 * `npx vitest run lib/athena/agent-permissions.test.ts`
 */
import { describe, expect, it } from "vitest";
import { checkAgentToolAccess } from "./agent-permissions";

const ROWS = [
  {
    toolSlug: "vectorcraft",
    allowed: true,
    scopes: ["vector.generate"],
    maxCostCents: 500,
  },
  { toolSlug: "mkvideos", allowed: false, scopes: [], maxCostCents: 0 },
  { toolSlug: "hyperframes", allowed: true, scopes: [], maxCostCents: 0 },
];

describe("checkAgentToolAccess (fail-closed)", () => {
  it("sem linha para a tool → NEGADO", () => {
    expect(checkAgentToolAccess(ROWS, "designcraft")).toMatchObject({
      allowed: false,
      reason: "no-agent-permission-row",
    });
  });

  it("linha allowed=false → NEGADO", () => {
    expect(checkAgentToolAccess(ROWS, "mkvideos")).toMatchObject({
      allowed: false,
      reason: "agent-tool-not-allowed",
    });
  });

  it("capability fora dos scopes → NEGADO", () => {
    expect(
      checkAgentToolAccess(ROWS, "vectorcraft", "video.generate"),
    ).toMatchObject({ allowed: false, reason: "capability-not-allowed" });
  });

  it("capability dentro dos scopes → PERMITIDO", () => {
    expect(
      checkAgentToolAccess(ROWS, "vectorcraft", "vector.generate"),
    ).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("scopes vazios = todas as capabilities da tool", () => {
    expect(
      checkAgentToolAccess(ROWS, "hyperframes", "qualquer.capability"),
    ).toMatchObject({ allowed: true, reason: "allowed" });
  });
});
