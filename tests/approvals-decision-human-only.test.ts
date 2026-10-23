/**
 * ATHENA TOOLS HUB — FASE 2B (C4): decisões de aprovação são EXCLUSIVAMENTE
 * humanas, garantido em CÓDIGO (bloqueio B4 da Fase 1).
 *
 * Antes da correção, a separação humano/máquina era apenas documental
 * (docs/ATHENA_MANUAL.md §3 recomendava não conceder o scope): uma chave
 * m2m COM `approvals:decide` passava em `requireScope` e, como
 * `resolveOrgScope` ignora papéis para m2m, conseguia aprovar/rejeitar
 * jobs — inclusive os que ela própria criou. Estes testes atacam esse
 * vetor ao nível da rota POST /api/v1/approvals/[id]/decision, com a
 * lógica REAL de lib/api-auth (authenticate/requireHumanSession/
 * requireScope/resolveOrgScope) sobre fronteiras falsas:
 *
 *   - key m2m COM approvals:decide tenta decidir → 403 (sessão humana);
 *   - key m2m sem o scope → 403; em ambos os casos decideApproval NUNCA
 *     é chamado (a tentativa morre na rota);
 *   - sessão member/viewer → 403 (papel insuficiente);
 *   - sessão sem membership na org do body → 403;
 *   - sem autenticação → 401;
 *   - controlos positivos: sessão owner e sessão admin decidem (200) e o
 *     ator registado é humano (type: "user").
 *
 * `npx vitest run tests/approvals-decision-human-only.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (hoisted) — fronteiras externas: sessão Supabase, chaves, serviço de
// jobs e rate limit. A lógica de lib/api-auth corre REAL por cima delas.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  requireOrgRole: vi.fn(),
  verifyApiKey: vi.fn(),
  decideApproval: vi.fn(),
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

vi.mock("@/lib/jobs/service", () => ({
  decideApproval: mocks.decideApproval,
}));

import { HubError } from "@/lib/errors";
import { requireHumanSession, type ApiAuthContext } from "@/lib/api-auth";
import { POST as decide } from "@/app/api/v1/approvals/[id]/decision/route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const API_KEYS: Record<
  string,
  { orgId: string; scopes: string[]; integrationId: string } | null
> = {
  // O atacante principal: chave de agente COM o scope de decisão.
  "key-com-decide": {
    orgId: ORG_A,
    scopes: ["tools:read", "jobs:read", "jobs:write", "approvals:decide"],
    integrationId: "int-athena",
  },
  "key-sem-decide": {
    orgId: ORG_A,
    scopes: ["tools:read", "jobs:read", "jobs:write"],
    integrationId: "int-athena",
  },
};

/** Papel da sessão de teste na org A (null = sem membership). */
let sessionRole: string | null = null;
/** Orgs onde a sessão tem membership (por omissão, só a org A). */
let sessionOrgs: string[] = [ORG_A];

beforeEach(() => {
  vi.clearAllMocks();
  sessionRole = null;
  sessionOrgs = [ORG_A];
  // Por omissão: sem sessão (os testes de sessão ligam-na explicitamente).
  mocks.getSession.mockResolvedValue(null);
  mocks.verifyApiKey.mockImplementation(
    async (token: string) => API_KEYS[token] ?? null,
  );
  mocks.requireOrgRole.mockImplementation(
    async (orgId: string, roles: string[]) => {
      if (!sessionOrgs.includes(orgId) || !sessionRole) {
        throw HubError.forbidden(
          "Você não tem permissão para esta organização/ação.",
        );
      }
      if (!roles.includes(sessionRole)) {
        throw HubError.forbidden(
          "Você não tem permissão para esta organização/ação.",
        );
      }
      return sessionRole;
    },
  );
  mocks.decideApproval.mockImplementation(
    async (
      id: string,
      orgId: string,
      decision: "approve" | "reject",
    ) => ({
      id,
      orgId,
      status: decision === "approve" ? "QUEUED" : "CANCELLED",
    }),
  );
});

function sessionOn(role: string, orgs: string[] = [ORG_A]) {
  sessionRole = role;
  sessionOrgs = orgs;
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
}

function decisionReq(opts: {
  bearer?: string;
  orgId?: string;
  decision?: "approve" | "reject";
}): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/approvals/${JOB_ID}/decision`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.bearer ? { authorization: "Bearer " + opts.bearer } : {}),
      },
      body: JSON.stringify({
        orgId: opts.orgId ?? ORG_A,
        decision: opts.decision ?? "approve",
        justification: "Briefing confere com o roteiro.",
      }),
    },
  );
}

const params = { params: Promise.resolve({ id: JOB_ID }) };

// ===========================================================================
// NEGATIVOS — máquinas nunca decidem (o coração da C4/B4)
// ===========================================================================
describe("C4 — chave de API (m2m) NÃO decide aprovações", () => {
  it("key COM approvals:decide a aprovar → 403 e decideApproval nunca é chamado", async () => {
    const res = await decide(decisionReq({ bearer: "key-com-decide" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toMatch(/sessão humana/i);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("key COM approvals:decide a rejeitar → 403 (idem)", async () => {
    const res = await decide(
      decisionReq({ bearer: "key-com-decide", decision: "reject" }),
      params,
    );
    expect(res.status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("key SEM approvals:decide → 403 e decideApproval nunca é chamado", async () => {
    const res = await decide(decisionReq({ bearer: "key-sem-decide" }), params);
    expect(res.status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("key inválida → 401", async () => {
    const res = await decide(decisionReq({ bearer: "key-inexistente" }), params);
    expect(res.status).toBe(401);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// NEGATIVOS — sessão sem papel/org não decide
// ===========================================================================
describe("C4 — sessão humana sem papel owner/admin NÃO decide", () => {
  it("sessão member → 403", async () => {
    sessionOn("member");
    const res = await decide(decisionReq({}), params);
    expect(res.status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("sessão viewer → 403", async () => {
    sessionOn("viewer");
    const res = await decide(decisionReq({}), params);
    expect(res.status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("sessão owner da org A a decidir na org B (sem membership) → 403", async () => {
    sessionOn("owner", [ORG_A]);
    const res = await decide(decisionReq({ orgId: ORG_B }), params);
    expect(res.status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("sem autenticação (sem Bearer, sem sessão) → 401", async () => {
    const res = await decide(decisionReq({}), params);
    expect(res.status).toBe(401);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POSITIVOS — sessão owner/admin continua a decidir (fluxo legítimo intacto)
// ===========================================================================
describe("C4 — sessão owner/admin decide normalmente", () => {
  it("sessão owner aprova → 200, job QUEUED, ator humano", async () => {
    sessionOn("owner");
    const res = await decide(decisionReq({}), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.id).toBe(JOB_ID);
    expect(body.job.status).toBe("QUEUED");
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1);
    const [, orgId, decision, , actor] = mocks.decideApproval.mock.calls[0];
    expect(orgId).toBe(ORG_A);
    expect(decision).toBe("approve");
    expect(actor).toEqual({ id: "user-1", type: "user" });
  });

  it("sessão admin rejeita → 200, job CANCELLED", async () => {
    sessionOn("admin");
    const res = await decide(decisionReq({ decision: "reject" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.status).toBe("CANCELLED");
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// UNIDADE — o guarda requireHumanSession em si
// ===========================================================================
describe("C4 — requireHumanSession (unidade)", () => {
  it("recusa contexto m2m mesmo com approvals:decide", () => {
    const ctx: ApiAuthContext = {
      kind: "m2m",
      orgId: ORG_A,
      scopes: ["approvals:decide"],
      integrationId: "int-athena",
    };
    expect(() => requireHumanSession(ctx)).toThrowError(/sessão humana/i);
  });

  it("aceita contexto de sessão de usuário", () => {
    const ctx: ApiAuthContext = { kind: "user", userId: "user-1" };
    expect(() => requireHumanSession(ctx)).not.toThrow();
  });
});
