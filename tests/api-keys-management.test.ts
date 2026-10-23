/**
 * FASE 2D (C5) — gestão de chaves de API é EXCLUSIVA de sessões humanas
 * owner/admin (o mesmo princípio da C4, aplicado às credenciais).
 *
 * Ao nível das rotas reais (POST/GET/DELETE
 * /api/v1/integrations/{id}/api-keys[/{keyId}]) com a lógica REAL de
 * lib/api-auth e lib/api-keys-admin sobre um admin falso:
 *
 *   - chave de API (m2m) a emitir/listar/revogar → 403, nada é escrito;
 *   - sessão member/viewer → 403; sessão de outra org → 403; sem auth → 401;
 *   - owner emite → 201: a chave crua e o segredo aparecem UMA vez, a BD
 *     guarda só o hash (sha256 da chave devolvida) e a referência; TTL
 *     default 90 dias; auditoria sem segredos;
 *   - scope inválido → 400; approvals:decide é emitível (a C4 é que o
 *     torna inútil para decidir — a emissão não é o guarda);
 *   - rotação: replacesKeyId liga a antiga à nova sem a revogar;
 *     replacesKeyId de outra org → 400;
 *   - listagem devolve metadados e NUNCA o hash;
 *   - revogação: imediata nos dados, idempotente, 404 cross-integração;
 *   - pré-0011 (tabela inexistente) → 501 honesto NOT_IMPLEMENTED.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks e fake DB (hoisted)
// ---------------------------------------------------------------------------
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const INT_ID = "44444444-4444-4444-8444-444444444444";
const KEY_OLD = "55555555-5555-4555-8555-555555555555";
const KEY_OTHER_ORG = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  requireOrgRole: vi.fn(),
  verifyApiKey: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  integration: null as null | Record<string, unknown>,
  keys: new Map<string, Record<string, unknown>>(),
  inserted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  tableExists: true,
}));

function buildFakeDb() {
  const missing = {
    code: "PGRST205",
    message: "Could not find the table 'public.api_keys' in the schema cache",
  };
  return {
    from(table: string) {
      if (table === "integrations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: dbState.integration,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            dbState.audits.push(row);
            return { error: null };
          },
        };
      }
      if (table === "api_keys") {
        if (!dbState.tableExists) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: missing }),
                eq: () => ({
                  order: async () => ({ data: null, error: missing }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: missing }),
              }),
            }),
            update: () => ({ eq: async () => ({ error: missing }) }),
          };
        }
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data: dbState.keys.get(val) ?? null,
                    error: null,
                  }),
                };
              }
              // listagem: eq(integration_id) → eq(org_id) → order(...)
              return {
                eq: () => ({
                  order: async () => ({
                    data: [...dbState.keys.values()].filter(
                      (k) => k.integration_id === INT_ID,
                    ),
                    error: null,
                  }),
                }),
              };
            },
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              maybeSingle: async () => {
                const stored = {
                  ...row,
                  created_at: new Date().toISOString(),
                  last_used_at: null,
                  revoked_at: null,
                  replaced_by_id: null,
                };
                dbState.keys.set(row.id as string, stored);
                dbState.inserted.push(row);
                return { data: stored, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const row = dbState.keys.get(val);
              if (row) Object.assign(row, patch);
              dbState.updates.push({ id: val, patch });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
}

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

vi.mock("@/lib/api-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-keys")>();
  return {
    verifyApiKey: mocks.verifyApiKey,
    checkReplayProtection: () => {},
    sha256Hex: actual.sha256Hex,
    generateApiKey: actual.generateApiKey,
    generateSigningSecret: actual.generateSigningSecret,
    isMissingTableError: actual.isMissingTableError,
    parseReplayHeaders: actual.parseReplayHeaders,
  };
});

import { HubError } from "@/lib/errors";
import {
  POST as issueKey,
  GET as listKeys,
} from "@/app/api/v1/integrations/[integrationId]/api-keys/route";
import { DELETE as revokeKey } from "@/app/api/v1/integrations/[integrationId]/api-keys/[keyId]/route";

// ---------------------------------------------------------------------------
// Fixtures e helpers
// ---------------------------------------------------------------------------
let sessionRole: string | null = null;
let sessionOrgs: string[] = [ORG_A];

function sessionOn(role: string, orgs: string[] = [ORG_A]) {
  sessionRole = role;
  sessionOrgs = orgs;
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
}

function seedKey(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const row = {
    id,
    org_id: ORG_A,
    integration_id: INT_ID,
    label: "Athena — produção",
    key_hash: "hash-da-chave-antiga",
    scopes: ["tools:read"],
    signing_secret_ref: id,
    created_by: "user-1",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    last_used_at: null,
    revoked_at: null,
    replaced_by_id: null,
    ...overrides,
  };
  dbState.keys.set(id, row);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionRole = null;
  sessionOrgs = [ORG_A];
  dbState.integration = {
    id: INT_ID,
    org_id: ORG_A,
    name: "Athena",
    state: "connected",
  };
  dbState.keys = new Map();
  dbState.inserted = [];
  dbState.updates = [];
  dbState.audits = [];
  dbState.tableExists = true;

  mocks.getSession.mockResolvedValue(null);
  mocks.getSupabaseAdmin.mockImplementation(() => buildFakeDb());
  mocks.verifyApiKey.mockImplementation(async (token: string) =>
    token === "agent-key"
      ? {
          orgId: ORG_A,
          scopes: ["tools:read", "jobs:read", "jobs:write", "approvals:decide"],
          integrationId: INT_ID,
        }
      : null,
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
});

const collectionParams = { params: Promise.resolve({ integrationId: INT_ID }) };
const itemParams = (keyId: string) => ({
  params: Promise.resolve({ integrationId: INT_ID, keyId }),
});

function issueReq(opts: {
  bearer?: string;
  body?: Record<string, unknown>;
}): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/integrations/${INT_ID}/api-keys`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.bearer ? { authorization: "Bearer " + opts.bearer } : {}),
      },
      body: JSON.stringify(opts.body ?? { label: "Athena — produção" }),
    },
  );
}

function plainReq(method: string, path: string, bearer?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: bearer ? { authorization: "Bearer " + bearer } : {},
  });
}

// ===========================================================================
// NEGATIVOS de autorização — máquinas e papéis errados não gerem chaves
// ===========================================================================
describe("C5 — emissão: quem NÃO pode", () => {
  it("chave de API (m2m, todos os scopes) a emitir → 403 e nada é inserido", async () => {
    const res = await issueKey(issueReq({ bearer: "agent-key" }), collectionParams);
    expect(res.status).toBe(403);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("sem autenticação → 401", async () => {
    const res = await issueKey(issueReq({}), collectionParams);
    expect(res.status).toBe(401);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("sessão member → 403; sessão viewer → 403", async () => {
    sessionOn("member");
    expect((await issueKey(issueReq({}), collectionParams)).status).toBe(403);
    sessionOn("viewer");
    expect((await issueKey(issueReq({}), collectionParams)).status).toBe(403);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("owner da org A com a integração na org B → 403", async () => {
    dbState.integration = { id: INT_ID, org_id: ORG_B, name: "Alheia", state: "connected" };
    sessionOn("owner", [ORG_A]);
    const res = await issueKey(issueReq({}), collectionParams);
    expect(res.status).toBe(403);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("integração inexistente → 404", async () => {
    dbState.integration = null;
    sessionOn("owner");
    const res = await issueKey(issueReq({}), collectionParams);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POSITIVO — emissão correta
// ===========================================================================
describe("C5 — emissão por owner/admin", () => {
  it("owner emite → 201: segredos uma vez, BD só com hash+ref, TTL 90 dias, auditoria limpa", async () => {
    sessionOn("owner");
    const before = Date.now();
    const res = await issueKey(issueReq({}), collectionParams);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.rawKey).toMatch(/^hub_live_[0-9a-f]{64}$/);
    expect(body.signingSecret).toMatch(/^hub_sign_[0-9a-f]{64}$/);
    expect(body.apiKey.label).toBe("Athena — produção");
    expect(body.apiKey.scopes).toEqual(["tools:read", "jobs:read", "jobs:write"]);
    expect(body.apiKey.signingSecretRef).toBe(body.apiKey.id);

    // O que foi gravado: hash sha256 da chave devolvida — nunca a chave.
    expect(dbState.inserted).toHaveLength(1);
    const stored = dbState.inserted[0];
    const expectedHash = createHash("sha256").update(body.rawKey).digest("hex");
    expect(stored.key_hash).toBe(expectedHash);
    expect(JSON.stringify(stored)).not.toContain(body.rawKey);
    expect(JSON.stringify(stored)).not.toContain(body.signingSecret);

    // TTL default = 90 dias (decisão ratificada).
    const expiresMs = Date.parse(stored.expires_at as string);
    expect(expiresMs).toBeGreaterThan(before + 89 * 86_400_000);
    expect(expiresMs).toBeLessThan(Date.now() + 91 * 86_400_000);

    // Auditoria: existe e NÃO contém segredos.
    const audit = dbState.audits.find((a) => a.action === "api_key.issued");
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain(body.rawKey);
    expect(JSON.stringify(audit)).not.toContain(body.signingSecret);
  });

  it("admin também emite; scopes explícitos (incl. approvals:decide) são respeitados", async () => {
    sessionOn("admin");
    const res = await issueKey(
      issueReq({
        body: {
          label: "Athena — leitura de aprovações",
          scopes: ["tools:read", "approvals:decide"],
        },
      }),
      collectionParams,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.apiKey.scopes).toEqual(["tools:read", "approvals:decide"]);
  });

  it("scope inválido → 400 e nada é inserido", async () => {
    sessionOn("owner");
    const res = await issueKey(
      issueReq({ body: { label: "x", scopes: ["admin:all"] } }),
      collectionParams,
    );
    expect(res.status).toBe(400);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("expiresInDays explícito é respeitado; withSigningSecret=false não emite segredo", async () => {
    sessionOn("owner");
    const res = await issueKey(
      issueReq({
        body: { label: "curta", expiresInDays: 30, withSigningSecret: false },
      }),
      collectionParams,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.signingSecret).toBeNull();
    expect(body.apiKey.signingSecretRef).toBeNull();
    const expiresMs = Date.parse(dbState.inserted[0].expires_at as string);
    expect(expiresMs).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(expiresMs).toBeLessThan(Date.now() + 31 * 86_400_000);
  });

  it("rotação: replacesKeyId liga a antiga à nova SEM a revogar", async () => {
    seedKey(KEY_OLD);
    sessionOn("owner");
    const res = await issueKey(
      issueReq({ body: { label: "nova", replacesKeyId: KEY_OLD } }),
      collectionParams,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const old = dbState.keys.get(KEY_OLD)!;
    expect(old.replaced_by_id).toBe(body.apiKey.id);
    expect(old.revoked_at).toBeNull();
  });

  it("replacesKeyId de outra org → 400 e nada é emitido", async () => {
    seedKey(KEY_OTHER_ORG, { org_id: ORG_B, integration_id: "outra-int" });
    sessionOn("owner");
    const res = await issueKey(
      issueReq({ body: { label: "nova", replacesKeyId: KEY_OTHER_ORG } }),
      collectionParams,
    );
    expect(res.status).toBe(400);
    expect(dbState.inserted).toHaveLength(0);
  });

  it("pré-0011 (tabela inexistente) → 501 NOT_IMPLEMENTED honesto", async () => {
    dbState.tableExists = false;
    sessionOn("owner");
    const res = await issueKey(issueReq({}), collectionParams);
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
    expect(body.error.message).toMatch(/0011/);
  });
});

// ===========================================================================
// LISTAGEM — metadados, nunca o hash
// ===========================================================================
describe("C5 — listagem", () => {
  it("m2m → 403", async () => {
    const res = await listKeys(
      plainReq("GET", `/api/v1/integrations/${INT_ID}/api-keys`, "agent-key"),
      collectionParams,
    );
    expect(res.status).toBe(403);
  });

  it("owner lista metadados; o hash NUNCA aparece na resposta", async () => {
    seedKey(KEY_OLD);
    sessionOn("owner");
    const res = await listKeys(
      plainReq("GET", `/api/v1/integrations/${INT_ID}/api-keys`),
      collectionParams,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKeys).toHaveLength(1);
    expect(body.apiKeys[0].id).toBe(KEY_OLD);
    expect(body.apiKeys[0]).not.toHaveProperty("key_hash");
    expect(JSON.stringify(body)).not.toContain("hash-da-chave-antiga");
  });
});

// ===========================================================================
// REVOGAÇÃO — imediata, idempotente, isolada
// ===========================================================================
describe("C5 — revogação", () => {
  it("m2m a revogar → 403 e a chave fica ativa", async () => {
    seedKey(KEY_OLD);
    const res = await revokeKey(
      plainReq("DELETE", `/api/v1/integrations/${INT_ID}/api-keys/${KEY_OLD}`, "agent-key"),
      itemParams(KEY_OLD),
    );
    expect(res.status).toBe(403);
    expect(dbState.keys.get(KEY_OLD)!.revoked_at).toBeNull();
    expect(dbState.updates).toHaveLength(0);
  });

  it("owner revoga → 200 com revokedAt; repetir é idempotente (sem 2ª escrita)", async () => {
    seedKey(KEY_OLD);
    sessionOn("owner");
    const first = await revokeKey(
      plainReq("DELETE", `/api/v1/integrations/${INT_ID}/api-keys/${KEY_OLD}`),
      itemParams(KEY_OLD),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.apiKey.revokedAt).toBeTruthy();
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.audits.filter((a) => a.action === "api_key.revoked")).toHaveLength(1);

    const second = await revokeKey(
      plainReq("DELETE", `/api/v1/integrations/${INT_ID}/api-keys/${KEY_OLD}`),
      itemParams(KEY_OLD),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.apiKey.revokedAt).toBe(firstBody.apiKey.revokedAt);
    expect(dbState.updates).toHaveLength(1);
  });

  it("chave de outra integração → 404 (não confirma existência alheia)", async () => {
    seedKey(KEY_OLD, { integration_id: "outra-integracao" });
    sessionOn("owner");
    const res = await revokeKey(
      plainReq("DELETE", `/api/v1/integrations/${INT_ID}/api-keys/${KEY_OLD}`),
      itemParams(KEY_OLD),
    );
    expect(res.status).toBe(404);
    expect(dbState.keys.get(KEY_OLD)!.revoked_at).toBeNull();
  });

  it("sessão member a revogar → 403", async () => {
    seedKey(KEY_OLD);
    sessionOn("member");
    const res = await revokeKey(
      plainReq("DELETE", `/api/v1/integrations/${INT_ID}/api-keys/${KEY_OLD}`),
      itemParams(KEY_OLD),
    );
    expect(res.status).toBe(403);
    expect(dbState.keys.get(KEY_OLD)!.revoked_at).toBeNull();
  });
});
