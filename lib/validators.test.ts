/**
 * Testes dos zod schemas de /api/v1 (lib/validators.ts).
 * Nenhum teste toca rede ou Supabase — tudo validação pura.
 */
import { describe, expect, it } from "vitest";
import { HubError } from "./errors";
import {
  createJobSchema,
  integrationConfigSchema,
  jobDecisionSchema,
  jobQuerySchema,
  paginationSchema,
  parseOrThrow,
  uuidSchema,
} from "./validators";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174000";

describe("uuidSchema", () => {
  it("aceita UUID válido", () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true);
  });
  it("rejeita string não-UUID", () => {
    const r = uuidSchema.safeParse("not-a-uuid");
    expect(r.success).toBe(false);
  });
  it("rejeita valor ausente", () => {
    expect(uuidSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("paginationSchema", () => {
  it("aplica defaults page=1 perPage=20", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, perPage: 20 });
  });
  it("coage strings numéricas", () => {
    expect(paginationSchema.parse({ page: "3", perPage: "10" })).toEqual({
      page: 3,
      perPage: 10,
    });
  });
  it("rejeita page < 1 e perPage > 100", () => {
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ perPage: 101 }).success).toBe(false);
  });
});

describe("createJobSchema", () => {
  const valid = {
    orgId: UUID,
    toolId: "vectorcraft",
    params: { prompt: "cartaz de café" },
    idempotencyKey: UUID2,
  };
  it("aceita input válido", () => {
    expect(createJobSchema.safeParse(valid).success).toBe(true);
  });
  it("rejeita orgId não-UUID", () => {
    const r = createJobSchema.safeParse({ ...valid, orgId: "abc" });
    expect(r.success).toBe(false);
  });
  it("rejeita toolId ausente ou vazio", () => {
    const { toolId: _toolId, ...noTool } = valid;
    expect(_toolId).toBeDefined(); // silencia no-unused-vars: campo removido no rest
    expect(createJobSchema.safeParse(noTool).success).toBe(false);
    expect(createJobSchema.safeParse({ ...valid, toolId: "" }).success).toBe(false);
  });
  it("rejeita params ausente", () => {
    const { params: _params, ...noParams } = valid;
    expect(_params).toBeDefined();
    expect(createJobSchema.safeParse(noParams).success).toBe(false);
  });
  it("rejeita idempotencyKey não-UUID", () => {
    expect(
      createJobSchema.safeParse({ ...valid, idempotencyKey: "x" }).success,
    ).toBe(false);
  });
});

describe("jobQuerySchema", () => {
  it("aceita query válida com status enum", () => {
    const r = jobQuerySchema.safeParse({ orgId: UUID, status: "RUNNING" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("RUNNING");
      expect(r.data.page).toBe(1);
    }
  });
  it("rejeita status fora do enum", () => {
    expect(
      jobQuerySchema.safeParse({ orgId: UUID, status: "HACKED" }).success,
    ).toBe(false);
  });
  it("status é opcional e orgId é obrigatório", () => {
    expect(jobQuerySchema.safeParse({}).success).toBe(false);
    const r = jobQuerySchema.safeParse({ orgId: UUID });
    expect(r.success).toBe(true);
  });
});

describe("jobDecisionSchema", () => {
  it("aceita approve/reject com justificativa", () => {
    expect(
      jobDecisionSchema.safeParse({ decision: "approve", justification: "ok" })
        .success,
    ).toBe(true);
    expect(
      jobDecisionSchema.safeParse({ decision: "reject", justification: "ruim" })
        .success,
    ).toBe(true);
  });
  it("rejeita decision fora do enum", () => {
    expect(
      jobDecisionSchema.safeParse({ decision: "maybe", justification: "x" })
        .success,
    ).toBe(false);
  });
  it("rejeita justificativa ausente", () => {
    expect(
      jobDecisionSchema.safeParse({ decision: "approve" }).success,
    ).toBe(false);
  });
});

describe("integrationConfigSchema", () => {
  const valid = {
    name: "Minha API",
    type: "api",
    scopes: ["tools:read"] as Array<"tools:read">,
  };
  it("aceita input válido com defaults state/config (alinhado ao schema real)", () => {
    const r = integrationConfigSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.state).toBe("cataloged");
      expect(r.data.config).toEqual({});
    }
  });
  it("rejeita type fora do enum integration_type", () => {
    expect(
      integrationConfigSchema.safeParse({ ...valid, type: "api_key" }).success,
    ).toBe(false);
    expect(
      integrationConfigSchema.safeParse({ ...valid, type: "oauth" }).success,
    ).toBe(false);
  });
  it("rejeita scopes vazio ou inválido", () => {
    expect(
      integrationConfigSchema.safeParse({ ...valid, scopes: [] }).success,
    ).toBe(false);
    expect(
      integrationConfigSchema.safeParse({ ...valid, scopes: ["admin"] }).success,
    ).toBe(false);
  });
  it("rejeita name ausente", () => {
    const { name: _name, ...noName } = valid;
    expect(_name).toBeDefined();
    expect(integrationConfigSchema.safeParse(noName).success).toBe(false);
  });
});

describe("parseOrThrow", () => {
  it("lança HubError VALIDATION em falha de schema", () => {
    try {
      parseOrThrow(createJobSchema, { orgId: "bad" });
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      expect((err as HubError).code).toBe("VALIDATION");
      expect((err as HubError).status).toBe(400);
    }
  });
  it("retorna dados parseados em sucesso", () => {
    const data = parseOrThrow(paginationSchema, { page: "2" });
    expect(data).toEqual({ page: 2, perPage: 20 });
  });
});
