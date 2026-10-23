/**
 * ATHENA TOOLS HUB — FASE 2A (C1): testes negativos de isolamento entre
 * organizações nos endpoints GET /api/v1/tools e GET /api/v1/tools/[id].
 *
 * Antes da correção (B1, CRÍTICO), as duas rotas usavam service_role SEM
 * filtro de org e SEM resolveOrgScope: qualquer autenticado lia as tools
 * de TODAS as orgs. Estes testes atacam exatamente esse vetor, ao nível da
 * rota, com a lógica REAL de lib/api-auth (authenticate/requireScope/
 * resolveOrgScope) e uma BD falsa em memória:
 *
 *   - key m2m da org A NUNCA vê tools da org B (lista nem detalhe);
 *   - key m2m a pedir orgId de outra org → 403;
 *   - sessão de membro da org A a pedir a org B → 403 (sem membership);
 *   - detalhe de tool de outra org = 404 INDISTINTO do de tool inexistente;
 *   - sem autenticação → 401; key sem scope tools:read → 403;
 *   - controlos positivos: a própria org continua legível; o fallback de
 *     adapter em código (contrato global, sem dados de org) continua 200.
 *
 * `npx vitest run tests/tools-org-isolation.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (hoisted) — fronteiras externas: auth do Supabase, chaves, BD, limites.
// A lógica de lib/api-auth corre REAL por cima destas fronteiras.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  requireOrgRole: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, headers: {} }),
  rateLimitIdentity: () => "test-identity",
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  isSupabaseConfigured: () => true,
  requireOrgRole: mocks.requireOrgRole,
}));

vi.mock("@/lib/api-keys", () => ({
  verifyApiKey: mocks.verifyApiKey,
  checkReplayProtection: () => {},
  sha256Hex: (s: string) => `hash:${s}`,
  // FASE 2D: lib/api-signing (importado por lib/api-auth) resolve estes
  // nomes do módulo real; no mock ficam inertes — as identidades falsas
  // não têm apiKeyId, logo o caminho novo nunca é executado aqui.
  parseReplayHeaders: () => {
    throw new Error("parseReplayHeaders não devia ser chamado neste teste");
  },
  isMissingTableError: () => false,
}));

vi.mock("@/lib/jobs/service", () => ({
  // Só integrationStatusFor é usado pela rota de detalhe; não é o alvo aqui.
  integrationStatusFor: () => "pending",
}));

import { HubError } from "@/lib/errors";
import { GET as listTools } from "@/app/api/v1/tools/route";
import { GET as getTool } from "@/app/api/v1/tools/[id]/route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const TOOL_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOOL_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface ToolRow {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  description: string | null;
  state: string;
  updated_at: string;
  tool_capabilities: Array<{ name: string }>;
  [key: string]: unknown;
}

const TOOL_ROWS: ToolRow[] = [
  {
    id: TOOL_A_ID,
    org_id: ORG_A,
    slug: "vectorcraft",
    name: "Tool Privada da Org A",
    description: null,
    state: "cataloged",
    updated_at: "2026-10-20T00:00:00.000Z",
    tool_capabilities: [{ name: "vector.generate" }],
  },
  {
    id: TOOL_B_ID,
    org_id: ORG_B,
    slug: "vectorcraft",
    name: "Tool Privada da Org B",
    description: null,
    state: "cataloged",
    updated_at: "2026-10-20T00:00:00.000Z",
    tool_capabilities: [{ name: "vector.generate" }],
  },
];

/** BD falsa: aplica os filtros .eq() sobre as linhas em memória. */
function makeFakeDb() {
  return {
    from() {
      const filters: Array<{ col: string; val: unknown }> = [];
      const match = () =>
        TOOL_ROWS.filter((r) => filters.every((f) => r[f.col] === f.val));
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return chain;
        },
        order: () => chain,
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: match(), error: null }),
      };
      return chain;
    },
  };
}

const API_KEYS: Record<
  string,
  { orgId: string; scopes: string[]; integrationId: string } | null
> = {
  "key-org-a": { orgId: ORG_A, scopes: ["tools:read"], integrationId: "int-a" },
  "key-org-b": { orgId: ORG_B, scopes: ["tools:read"], integrationId: "int-b" },
  "key-sem-scope": {
    orgId: ORG_A,
    scopes: ["jobs:read"],
    integrationId: "int-a2",
  },
};

/** Memberships da sessão de teste: user-1 pertence SÓ à org A (member). */
const MEMBERSHIPS: Record<string, string> = { [ORG_A]: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseAdmin.mockReturnValue(makeFakeDb());
  // Por omissão: sem sessão (os testes de sessão ligam-na explicitamente).
  mocks.getSession.mockResolvedValue(null);
  mocks.verifyApiKey.mockImplementation(
    async (token: string) => API_KEYS[token] ?? null,
  );
  mocks.requireOrgRole.mockImplementation(
    async (orgId: string, roles: string[]) => {
      const role = MEMBERSHIPS[orgId];
      if (!role || !roles.includes(role)) {
        throw HubError.forbidden(
          "Você não tem permissão para esta organização/ação.",
        );
      }
      return role;
    },
  );
});

function sessionOn() {
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
}

function listReq(url: string, bearer?: string): NextRequest {
  return new NextRequest(url, {
    headers: bearer ? { authorization: "Bearer " + bearer } : {},
  });
}

function detailReq(bearer?: string, orgId?: string): NextRequest {
  const q = orgId ? `?orgId=${orgId}` : "";
  return new NextRequest(`http://localhost/api/v1/tools/x${q}`, {
    headers: bearer ? { authorization: "Bearer " + bearer } : {},
  });
}

const detailParams = (id: string) => ({ params: Promise.resolve({ id }) });

// ===========================================================================
// LISTA — GET /api/v1/tools
// ===========================================================================
describe("C1 — GET /api/v1/tools (lista) é isolada por organização", () => {
  it("key m2m da org A vê APENAS as tools da org A", async () => {
    const res = await listTools(
      listReq("http://localhost/api/v1/tools", "key-org-a"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { id: string }) => t.id)).toEqual([TOOL_A_ID]);
    expect(JSON.stringify(body)).not.toContain("Org B");
  });

  it("key m2m da org A a pedir ?orgId=<org B> → 403", async () => {
    const res = await listTools(
      listReq(`http://localhost/api/v1/tools?orgId=${ORG_B}`, "key-org-a"),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("key m2m da org B vê apenas as tools da org B (controlo simétrico)", async () => {
    const res = await listTools(
      listReq("http://localhost/api/v1/tools", "key-org-b"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { id: string }) => t.id)).toEqual([TOOL_B_ID]);
  });

  it("sessão de membro da org A com ?orgId=A vê as tools da org A", async () => {
    sessionOn();
    const res = await listTools(
      listReq(`http://localhost/api/v1/tools?orgId=${ORG_A}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { id: string }) => t.id)).toEqual([TOOL_A_ID]);
  });

  it("sessão sem membership na org B a pedir ?orgId=B → 403", async () => {
    sessionOn();
    const res = await listTools(
      listReq(`http://localhost/api/v1/tools?orgId=${ORG_B}`),
    );
    expect(res.status).toBe(403);
  });

  it("sem autenticação (sem Bearer, sem sessão) → 401", async () => {
    const res = await listTools(listReq("http://localhost/api/v1/tools"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("key m2m sem scope tools:read → 403", async () => {
    const res = await listTools(
      listReq("http://localhost/api/v1/tools", "key-sem-scope"),
    );
    expect(res.status).toBe(403);
  });

  it("key m2m inválida → 401", async () => {
    const res = await listTools(
      listReq("http://localhost/api/v1/tools", "key-inexistente"),
    );
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// DETALHE — GET /api/v1/tools/[id]
// ===========================================================================
describe("C1 — GET /api/v1/tools/[id] (detalhe) é isolado por organização", () => {
  it("key m2m da org A lê a tool da própria org → 200", async () => {
    const res = await getTool(
      detailReq("key-org-a"),
      detailParams(TOOL_A_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.id).toBe(TOOL_A_ID);
    expect(body.tool.name).toBe("Tool Privada da Org A");
  });

  it("key m2m da org A a ler tool da org B → 404, sem vazar o nome", async () => {
    const res = await getTool(
      detailReq("key-org-a"),
      detailParams(TOOL_B_ID),
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("Org B");
    expect(JSON.parse(text).error.code).toBe("NOT_FOUND");
  });

  it("404 de tool de outra org é INDISTINTO do de tool inexistente", async () => {
    const cross = await getTool(
      detailReq("key-org-a"),
      detailParams(TOOL_B_ID),
    );
    const missing = await getTool(
      detailReq("key-org-a"),
      detailParams(MISSING_ID),
    );
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    const crossBody = await cross.json();
    const missingBody = await missing.json();
    expect(crossBody.error.code).toBe(missingBody.error.code);
    expect(crossBody.error.message).toBe(missingBody.error.message);
  });

  it("sessão de membro da org A (?orgId=A) a ler tool da org B → 404", async () => {
    sessionOn();
    const res = await getTool(
      detailReq(undefined, ORG_A),
      detailParams(TOOL_B_ID),
    );
    expect(res.status).toBe(404);
  });

  it("sessão sem membership na org B (?orgId=B) → 403 antes de qualquer leitura", async () => {
    sessionOn();
    const res = await getTool(
      detailReq(undefined, ORG_B),
      detailParams(TOOL_B_ID),
    );
    expect(res.status).toBe(403);
  });

  it("sem autenticação → 401", async () => {
    const res = await getTool(detailReq(), detailParams(TOOL_A_ID));
    expect(res.status).toBe(401);
  });

  it("key m2m sem scope tools:read → 403", async () => {
    const res = await getTool(
      detailReq("key-sem-scope"),
      detailParams(TOOL_A_ID),
    );
    expect(res.status).toBe(403);
  });

  it("fallback de adapter em código (contrato global, sem dados de org) continua acessível → 200", async () => {
    const res = await getTool(
      detailReq("key-org-a"),
      detailParams("vectorcraft"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool.id).toBe("vectorcraft");
    expect(body.tool.status).toBe("in-development");
  });
});
