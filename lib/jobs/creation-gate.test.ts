/**
 * Correção definitiva G3 (27/10/2026): gating honesto da Nova tarefa.
 * Sem rede, sem BD. Trava:
 * 1. o gate de criação (só avança com executor operacional confirmado);
 * 2. a identidade canónica do job (uuid OU slug → slug para o adapter);
 * 3. o integrationStatus calculado pelo SLUG — o bug que prendia o
 *    detalhe em 'pending' mesmo com executor pronto (adapterFor(uuid)
 *    devolve sempre undefined, porque o registry é chaveado por slug).
 */
import { describe, expect, it } from "vitest";
import {
  jobCreationGate,
  type CreationGate,
} from "@/lib/workflow-models";
import { resolveJobToolIdentity } from "@/lib/jobs/service";
import { toToolDTO } from "@/app/api/v1/tools/route";
import { toolRegistry } from "@/lib/adapters/index";

const UUID = "11111111-1111-4111-8111-111111111111";

function row(slug: string | undefined, id = UUID) {
  return {
    id,
    ...(slug === undefined ? {} : { slug }),
    name: "Tool",
    description: null,
    state: "in-development",
    updated_at: "2026-10-27T00:00:00.000Z",
    tool_capabilities: [],
  };
}

describe("jobCreationGate", () => {
  const base = {
    selected: true,
    detailLoading: false,
    detailError: false,
    operational: true,
  };
  it("permite só com seleção + detalhe carregado + executor operacional", () => {
    expect(jobCreationGate(base)).toEqual({ allowed: true, reason: null });
  });
  it("bloqueia sem seleção", () => {
    const g: CreationGate = jobCreationGate({ ...base, selected: false });
    expect(g).toEqual({ allowed: false, reason: "no-selection" });
  });
  it("bloqueia enquanto o detalhe carrega", () => {
    const g: CreationGate = jobCreationGate({ ...base, detailLoading: true });
    expect(g).toEqual({ allowed: false, reason: "detail-loading" });
  });
  it("bloqueia com erro no detalhe (não assume nem operacional nem sem executor)", () => {
    const g: CreationGate = jobCreationGate({
      ...base,
      detailError: true,
      operational: false,
    });
    expect(g).toEqual({ allowed: false, reason: "detail-error" });
  });
  it("bloqueia ferramenta sem executor confirmado", () => {
    const g: CreationGate = jobCreationGate({ ...base, operational: false });
    expect(g).toEqual({ allowed: false, reason: "no-executor" });
  });
});

describe("resolveJobToolIdentity", () => {
  it("linha por uuid → uuid para FK + slug para o adapter", () => {
    expect(resolveJobToolIdentity(UUID, { id: UUID, slug: "photocraft" })).toEqual({
      toolUuid: UUID,
      toolSlug: "photocraft",
    });
  });
  it("linha por slug → o mesmo par", () => {
    expect(
      resolveJobToolIdentity("photocraft", { id: UUID, slug: "photocraft" }),
    ).toEqual({ toolUuid: UUID, toolSlug: "photocraft" });
  });
  it("sem linha → preserva o input como slug, uuid null", () => {
    expect(resolveJobToolIdentity("tool-desconhecida", null)).toEqual({
      toolUuid: null,
      toolSlug: "tool-desconhecida",
    });
  });
});

describe("toToolDTO integrationStatus pelo slug", () => {
  it("slug sem adapter → pending", () => {
    expect(toToolDTO(row("photocraft")).integrationStatus).toBe("pending");
  });
  it("linha sem slug → pending (compatibilidade retroativa)", () => {
    expect(toToolDTO(row(undefined)).integrationStatus).toBe("pending");
  });
  it("uuid no id NÃO decide o estado: o slug decide (regressão do bug)", () => {
    // Adapter só de teste, executionReady=true. Antes da correção, o
    // detalhe calculava integrationStatusFor(dto.id=uuid) → sempre pending.
    toolRegistry.register({
      id: "test-ready-tool",
      version: "0.0.0-test",
      capabilities: [],
      executionReady: true,
      validateParams: () => ({ ok: true, errors: [] }),
      dryRunInfo: () => ({ requiresApproval: false }),
    });
    const dto = toToolDTO(row("test-ready-tool"));
    expect(dto.slug).toBe("test-ready-tool");
    expect(dto.integrationStatus).toBe("ready");
  });
});
