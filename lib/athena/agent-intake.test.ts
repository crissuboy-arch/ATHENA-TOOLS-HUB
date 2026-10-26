/**
 * Testes da verificação agente↔ferramenta na intake (Opção A, fail-closed).
 *
 * Sem base real: a store é um stub em memória. Nenhum teste toca no
 * Supabase, em executores reais ou em dados de clientes. O caso
 * "schema indisponível" é simulado por uma store que LANÇA — o mesmo
 * comportamento que a coluna `agent_id` inexistente (0012 por aplicar)
 * produz no adaptador real (erro 42703 → schema-unavailable).
 *
 * `npx vitest run lib/athena/agent-intake.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  authorizeAgentToolAccess,
  resolveAgentToolAccess,
  type AgentIntakeResolution,
  type AgentIntakeStore,
} from "@/lib/athena/agent-intake";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a";
const TOOL_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_UUID = "33333333-3333-4333-8333-333333333333";
const GHOST_UUID = "44444444-4444-4444-8444-444444444444";

function storeFixture(
  overrides: Partial<AgentIntakeStore> = {},
): AgentIntakeStore {
  return {
    getIntegrationAgentId: async () => ({ agentId: AGENT_ID }),
    agentExists: async () => true,
    listAgentPermissions: async () => [
      {
        toolId: TOOL_UUID,
        allowed: true,
        scopes: [],
        maxCostCents: 0,
      },
      {
        toolId: OTHER_UUID,
        allowed: false,
        scopes: ["stats.read"],
        maxCostCents: 0,
      },
      // tool_id sem slug resolvível: tem de ser descartado, nunca inventado.
      { toolId: GHOST_UUID, allowed: true, scopes: [], maxCostCents: 0 },
    ],
    resolveToolSlugs: async (toolIds) => {
      const map = new Map<string, string>();
      if (toolIds.includes(TOOL_UUID)) map.set(TOOL_UUID, "vectorcraft");
      if (toolIds.includes(OTHER_UUID)) map.set(OTHER_UUID, "hyperframes");
      return map;
    },
    ...overrides,
  };
}

describe("authorizeAgentToolAccess — decisão pura, fail-closed", () => {
  const resolved: AgentIntakeResolution = {
    status: "resolved",
    agentId: AGENT_ID,
    rows: [
      { toolSlug: "vectorcraft", allowed: true, scopes: [], maxCostCents: 0 },
      {
        toolSlug: "hyperframes",
        allowed: true,
        scopes: ["render"],
        maxCostCents: 500,
      },
    ],
  };

  it("associado, scopes vazios (= todas) → permitido", () => {
    expect(authorizeAgentToolAccess(resolved, "vectorcraft").allowed).toBe(
      true,
    );
  });

  it("associado, capability dentro de scopes → permitido", () => {
    expect(
      authorizeAgentToolAccess(resolved, "hyperframes", "render").allowed,
    ).toBe(true);
  });

  it("associado, capability fora de scopes → negado", () => {
    const d = authorizeAgentToolAccess(resolved, "hyperframes", "delete");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("capability-not-allowed");
  });

  it("tool sem linha → negado, nunca permitido por omissão", () => {
    const d = authorizeAgentToolAccess(resolved, "tool-qualquer");
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no-agent-permission-row");
  });

  it("allowed=false → negado", () => {
    const d = authorizeAgentToolAccess(
      {
        status: "resolved",
        agentId: AGENT_ID,
        rows: [
          {
            toolSlug: "vectorcraft",
            allowed: false,
            scopes: [],
            maxCostCents: 0,
          },
        ],
      },
      "vectorcraft",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("agent-tool-not-allowed");
  });

  it("sem agente vinculado → negado", () => {
    const d = authorizeAgentToolAccess(
      { status: "no-agent-linked" },
      "vectorcraft",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no-agent-linked");
  });

  it("agente desconhecido → negado", () => {
    const d = authorizeAgentToolAccess(
      { status: "agent-unknown" },
      "vectorcraft",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("agent-unknown");
  });

  it("schema indisponível → negado", () => {
    const d = authorizeAgentToolAccess(
      { status: "schema-unavailable" },
      "vectorcraft",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("agent-schema-unavailable");
  });
});

describe("resolveAgentToolAccess — resolução uuid→slug, fail-closed", () => {
  it("caminho feliz: resolve slugs, descarta tool_id sem slug", async () => {
    const r = await resolveAgentToolAccess(storeFixture(), {
      integrationId: "integration-athena",
      orgId: ORG_ID,
    });
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") throw new Error("esperava resolved");
    expect(r.agentId).toBe(AGENT_ID);
    expect(r.rows.map((row) => row.toolSlug).sort()).toEqual([
      "hyperframes",
      "vectorcraft",
    ]);
    const vector = r.rows.find((row) => row.toolSlug === "vectorcraft");
    expect(vector?.allowed).toBe(true);
    const hyper = r.rows.find((row) => row.toolSlug === "hyperframes");
    expect(hyper?.allowed).toBe(false);
  });

  it("integração inexistente → agent-unknown", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({ getIntegrationAgentId: async () => null }),
      { integrationId: "integracao-fantasma", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "agent-unknown" });
  });

  it("agent_id NULL (integração sem agente) → no-agent-linked", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({ getIntegrationAgentId: async () => ({ agentId: null }) }),
      { integrationId: "integration-athena", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "no-agent-linked" });
  });

  it("agente inexistente → agent-unknown", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({ agentExists: async () => false }),
      { integrationId: "integration-athena", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "agent-unknown" });
  });

  it("falha na leitura da integração (ex.: coluna agent_id inexistente, 42703) → schema-unavailable, sem crash", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({
        getIntegrationAgentId: async () => {
          throw new Error('column "agent_id" does not exist (42703)');
        },
      }),
      { integrationId: "integration-athena", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "schema-unavailable" });
  });

  it("falha na leitura das permissões → schema-unavailable", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({
        listAgentPermissions: async () => {
          throw new Error("relation does not exist");
        },
      }),
      { integrationId: "integration-athena", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "schema-unavailable" });
  });

  it("falha na resolução de slugs → schema-unavailable", async () => {
    const r = await resolveAgentToolAccess(
      storeFixture({
        resolveToolSlugs: async () => {
          throw new Error("tools lookup failed");
        },
      }),
      { integrationId: "integration-athena", orgId: ORG_ID },
    );
    expect(r).toEqual({ status: "schema-unavailable" });
  });
});
