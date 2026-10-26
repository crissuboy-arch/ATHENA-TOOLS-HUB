/**
 * Testes da descoberta Athena (lib/athena/discovery.ts) — puros, sem I/O.
 * `npx vitest run lib/athena/discovery.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  buildAthenaToolDiscovery,
  discoveryExecutionSummary,
} from "./discovery";

describe("buildAthenaToolDiscovery", () => {
  it("une adapters + catálogo sem duplicar ids", () => {
    const tools = buildAthenaToolDiscovery();
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 4 adapters registrados, todos dentro dos 12 do catálogo.
    for (const id of ["vectorcraft", "hyperframes", "apify-mcp", "mkvideos"]) {
      expect(ids).toContain(id);
    }
    expect(ids).toContain("designcraft"); // só catálogo, sem adapter
  });

  it("nenhum adapter real está pronto: tudo pending, sem execução simulada", () => {
    const tools = buildAthenaToolDiscovery();
    for (const t of tools) {
      expect(t.executionReady).toBe(false);
      expect(t.integrationStatus).toBe("pending");
    }
    expect(discoveryExecutionSummary(tools)).toEqual({
      ready: 0,
      pending: tools.length,
      total: tools.length,
    });
  });

  it("toda tool exige aprovação por omissão ou por contrato", () => {
    const tools = buildAthenaToolDiscovery();
    for (const t of tools) expect(t.requiresApproval).toBe(true);
  });

  it("inputs do catálogo quando especificados, null quando ausentes", () => {
    const tools = buildAthenaToolDiscovery();
    const vectorcraft = tools.find((t) => t.id === "vectorcraft")!;
    expect(vectorcraft.inputs?.map((i) => i.name)).toContain("prompt");
    const designcraft = tools.find((t) => t.id === "designcraft")!;
    expect(designcraft.inputs).toBeNull();
  });

  it("sem linhas de permissão, nenhuma permissão por agente é afirmada", () => {
    const tools = buildAthenaToolDiscovery();
    for (const t of tools) expect(t.agentPermission).toBeNull();
  });

  it("com linhas resolvidas, a permissão aparece na entrada certa", () => {
    const tools = buildAthenaToolDiscovery([
      {
        toolSlug: "vectorcraft",
        allowed: true,
        scopes: ["vector.generate"],
        maxCostCents: 0,
      },
    ]);
    expect(
      tools.find((t) => t.id === "vectorcraft")!.agentPermission,
    ).toEqual({
      allowed: true,
      scopes: ["vector.generate"],
      maxCostCents: 0,
    });
    expect(
      tools.find((t) => t.id === "mkvideos")!.agentPermission,
    ).toBeNull();
  });
});
