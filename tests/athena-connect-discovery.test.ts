/**
 * ATHENA CONNECT — descoberta (rota) + correção do fallback de contrato.
 *
 * (a) CONEXÃO: GET /api/v1/athena/tools responde 200 com o contrato de
 *     descoberta (tools, execution.ready/pending, caller, agentPermissions).
 * (b) AUTENTICAÇÃO: sem Bearer → 401; Bearer sem scope tools:read → 403.
 * (c) CORREÇÃO: GET /api/v1/tools/[id] com Supabase NÃO configurado já
 *     devolve o contrato em código do adapter (antes: 503, fallback
 *     inalcançável); tool sem adapter → 404.
 *
 * Fronteiras mockadas: rate-limit, chaves (identidade m2m fixa, sem
 * apiKeyId → caminho legado, anti-replay inerte), Supabase (só o flag
 * de configuração + admin falso), jobs/service (só integrationStatusFor).
 * A lógica de lib/api-auth corre REAL por cima destas fronteiras.
 *
 * `npx vitest run tests/athena-connect-discovery.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORG_ID = "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a";
let scopes: string[] = ["tools:read", "jobs:read", "jobs:write"];

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, headers: {} }),
  rateLimitIdentity: () => "test-identity",
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  // O ponto da correção: Supabase NÃO configurado nesta suite.
  isSupabaseConfigured: () => false,
  requireOrgRole: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => ({
  verifyApiKey: vi.fn(async (raw: string) => {
    if (raw !== "hub_live_test") return null;
    return { orgId: ORG_ID, scopes, integrationId: "integration-athena" };
  }),
  checkReplayProtection: () => {},
  sha256Hex: (s: string) => `hash:${s}`,
  parseReplayHeaders: () => {
    throw new Error("parseReplayHeaders não devia ser chamado neste teste");
  },
  isMissingTableError: () => false,
}));

vi.mock("@/lib/jobs/service", () => ({
  integrationStatusFor: () => "pending",
}));

import { GET as discoverTools } from "@/app/api/v1/athena/tools/route";
import { GET as getTool } from "@/app/api/v1/tools/[id]/route";

interface DiscoveryTool {
  id: string;
  executionReady: boolean;
  integrationStatus: string;
  requiresApproval: boolean;
  capabilities: string[];
}

interface DiscoveryBody {
  orgId: string;
  tools: DiscoveryTool[];
  execution: { ready: number; pending: number; total: number };
  caller: { canDecideApprovals: boolean; canCreateJobs: boolean };
  agentPermissions: { linked: boolean };
}

interface ToolDetailBody {
  tool: { id: string; status: string; integrationStatus: string };
  error: { code: string };
}

function request(path: string, bearer?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new NextRequest(`http://hub.test${path}`, { headers });
}

beforeEach(() => {
  scopes = ["tools:read", "jobs:read", "jobs:write"];
});

describe("GET /api/v1/athena/tools — conexão e autenticação", () => {
  it("(a) conexão: 200 com descoberta estruturada, tudo pending", async () => {
    const res = await discoverTools(request("/api/v1/athena/tools", "hub_live_test"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown as DiscoveryBody;
    expect(body.orgId).toBe(ORG_ID);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThanOrEqual(4);
    for (const t of body.tools) {
      expect(t.executionReady).toBe(false);
      expect(t.integrationStatus).toBe("pending");
      expect(t.requiresApproval).toBe(true);
      expect(Array.isArray(t.capabilities)).toBe(true);
    }
    expect(body.execution).toMatchObject({ ready: 0 });
    expect(body.execution.total).toBe(body.tools.length);
    // A Athena NÃO decide aprovações, mesmo com scopes operacionais.
    expect(body.caller.canDecideApprovals).toBe(false);
    expect(body.caller.canCreateJobs).toBe(true);
    // Nenhum vínculo agente↔chamador é afirmado (sem agent_id no schema).
    expect(body.agentPermissions.linked).toBe(false);
    expect(body.tools.map((t) => t.id)).toContain("vectorcraft");
  });

  it("(b) sem auth → 401", async () => {
    const res = await discoverTools(request("/api/v1/athena/tools"));
    expect(res.status).toBe(401);
  });

  it("(b) sem scope tools:read → 403", async () => {
    scopes = ["jobs:read"];
    const res = await discoverTools(request("/api/v1/athena/tools", "hub_live_test"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/tools/[id] — fallback sem Supabase (correção)", () => {
  it("adapter em código responde 200 mesmo sem BD configurada", async () => {
    const res = await getTool(request("/api/v1/tools/vectorcraft", "hub_live_test"), {
      params: Promise.resolve({ id: "vectorcraft" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown as ToolDetailBody;
    expect(body.tool.id).toBe("vectorcraft");
    expect(body.tool.status).toBe("in-development");
    expect(body.tool.integrationStatus).toBe("pending");
  });

  it("tool sem adapter e sem BD → 404 estruturado (não 503, não 500)", async () => {
    const res = await getTool(request("/api/v1/tools/nope", "hub_live_test"), {
      params: Promise.resolve({ id: "tool-inexistente" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as unknown as ToolDetailBody;
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
