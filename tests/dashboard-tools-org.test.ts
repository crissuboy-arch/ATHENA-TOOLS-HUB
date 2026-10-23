/**
 * ATHENA TOOLS HUB — FASE 2B: regressão da correção de compatibilidade da
 * UI (efeito colateral da C1 da Fase 2A).
 *
 * Desde a C1, GET /api/v1/tools exige a org resolvida: sessão sem
 * `?orgId` → 400. O dashboard era a única página que chamava a rota SEM
 * orgId (componente cliente único, sem contexto de org) e mostrava erro.
 * A correção divide a página em wrapper server (getOrgs) + DashboardClient
 * (useOrg) e envia o orgId da org ATIVA via withOrg — sem bypass admin e
 * sem relaxar a C1.
 *
 * Este teste fixa as duas metades do comportamento:
 *   1. ANTI-DRIFT (fonte): o DashboardClient constrói o URL de tools com
 *      withOrg("/api/v1/tools", orgId) e a page é wrapper server que lhe
 *      passa as orgs de getOrgs — se alguém voltar a chamar a rota sem
 *      org, o teste falha.
 *   2. ROTA (forma exata do pedido do dashboard): sessão membro da org A
 *      com ?orgId=A → 200 e SÓ tools da org A; com ?orgId=B (org alheia)
 *      → 403 (o par negativo da C1, reafirmado na forma do dashboard).
 *
 * `npx vitest run tests/dashboard-tools-org.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks (hoisted) — mesmo padrão dos testes da C1 (tests/tools-org-isolation).
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
}));

import { HubError } from "@/lib/errors";
import { GET as listTools } from "@/app/api/v1/tools/route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const TOOL_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOOL_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    name: "Tool da Org A",
    description: null,
    state: "cataloged",
    updated_at: "2026-10-20T00:00:00.000Z",
    tool_capabilities: [{ name: "vector.generate" }],
  },
  {
    id: TOOL_B_ID,
    org_id: ORG_B,
    slug: "vectorcraft",
    name: "Tool da Org B",
    description: null,
    state: "cataloged",
    updated_at: "2026-10-20T00:00:00.000Z",
    tool_capabilities: [{ name: "vector.generate" }],
  },
];

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
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: match(), error: null }),
      };
      return chain;
    },
  };
}

/** Memberships da sessão de teste: user-1 pertence SÓ à org A. */
const MEMBERSHIPS: Record<string, string> = { [ORG_A]: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseAdmin.mockReturnValue(makeFakeDb());
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.verifyApiKey.mockResolvedValue(null);
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

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ===========================================================================
// 1. ANTI-DRIFT — a fonte do dashboard envia o orgId da org ativa
// ===========================================================================
describe("UI (2B) — fonte do dashboard inclui o orgId selecionado", () => {
  it("DashboardClient constrói o URL de tools com withOrg(orgId)", () => {
    const src = read("app/(app)/DashboardClient.tsx");
    expect(src).toMatch(/withOrg\("\/api\/v1\/tools",\s*orgId\)/);
    expect(src).toMatch(/useOrg\(orgs\)/);
  });

  it("page do dashboard é wrapper server que passa as orgs (getOrgs)", () => {
    const src = read("app/(app)/page.tsx");
    expect(src).toMatch(/getOrgs\(\)/);
    expect(src).toMatch(/<DashboardClient orgs=\{orgs\} \/>/);
    // A page deixou de ser o componente cliente monolítico de antes.
    expect(src).not.toMatch(/"use client"/);
  });

  it("nenhuma chamada a /api/v1/tools sem orgId fora do fallback sem-org", () => {
    const src = read("app/(app)/DashboardClient.tsx");
    const bare = src.match(/useApiList\("\/api\/v1\/tools"\)/g) ?? [];
    expect(bare).toHaveLength(0);
  });
});

// ===========================================================================
// 2. ROTA — a forma exata do pedido que o dashboard agora faz
// ===========================================================================
describe("UI (2B) — pedido do dashboard respeita o isolamento (C1)", () => {
  it("sessão com ?orgId=<org ativa> → 200 e só tools dessa org", async () => {
    const res = await listTools(
      new NextRequest(`http://localhost/api/v1/tools?orgId=${ORG_A}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools.map((t: { id: string }) => t.id)).toEqual([TOOL_A_ID]);
    expect(JSON.stringify(body)).not.toContain("Org B");
  });

  it("sessão com ?orgId=<org alheia> → 403 (par negativo da C1)", async () => {
    const res = await listTools(
      new NextRequest(`http://localhost/api/v1/tools?orgId=${ORG_B}`),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("sessão SEM ?orgId → 400 (o erro que o dashboard antigo recebia)", async () => {
    const res = await listTools(
      new NextRequest("http://localhost/api/v1/tools"),
    );
    expect(res.status).toBe(400);
  });
});
