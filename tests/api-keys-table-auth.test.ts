/**
 * FASE 2D (C5) — verifyApiKey em dois caminhos (spec §4.4).
 *
 * Com a implementação REAL de lib/api-keys.ts sobre um admin falso que
 * conhece as DUAS tabelas (sem rede, sem credenciais):
 *
 *   - chave válida na tabela `api_keys` → identidade com apiKeyId,
 *     source "api_keys", e last_used_at atualizado (throttle 60 s);
 *   - chave EXPIRADA → null (401 no chamador) + auditoria auth.key_expired;
 *   - chave REVOGADA → null + auditoria auth.key_revoked — e o MESMO hash
 *     presente no legado NÃO a ressuscita (a tabela nova é decisiva);
 *   - mundo pré-0011 (tabela inexistente) → o legado autentica como antes;
 *   - tabela existe mas sem a linha → cai para o legado (transição);
 *   - HUB_API_KEYS_LEGACY_FALLBACK=false → chave só-legada é recusada;
 *   - chave sem integration_id → integrationId = o id da própria chave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake admin com as duas tabelas
// ---------------------------------------------------------------------------
interface ApiKeyRowFixture {
  id: string;
  org_id: string;
  integration_id: string | null;
  key_hash: string;
  scopes: string[];
  signing_secret_ref: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

const fake = vi.hoisted(() => {
  const state = {
    configured: true,
    tableExists: true,
    apiKeys: [] as ApiKeyRowFixture[],
    integrations: [] as Array<{
      id: string;
      org_id: string;
      config: { apiKeyHash?: string; scopes?: string[] } | null;
    }>,
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    auditInserts: [] as Array<Record<string, unknown>>,
  };

  const missingTable = {
    code: "PGRST205",
    message: "Could not find the table in the schema cache",
  };

  const admin = {
    from(table: string) {
      if (table === "api_keys") {
        return {
          select() {
            return {
              eq(_col: string, val: string) {
                return {
                  maybeSingle: async () => {
                    if (!state.tableExists) {
                      return { data: null, error: missingTable };
                    }
                    const row =
                      state.apiKeys.find((k) => k.key_hash === val) ?? null;
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: async (_col: string, val: string) => {
                state.updates.push({ id: val, patch });
                return { error: null };
              },
            };
          },
        };
      }
      if (table === "integrations") {
        return {
          select() {
            return {
              eq: async () => ({ data: state.integrations, error: null }),
            };
          },
        };
      }
      if (table === "audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.auditInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
  return { state, admin };
});

vi.mock("@/lib/auth", () => ({
  isSupabaseConfigured: () => fake.state.configured,
  getSupabaseAdmin: () => fake.admin,
}));

import { generateApiKey, verifyApiKey } from "@/lib/api-keys";

const ORG = "11111111-1111-4111-8111-111111111111";
const savedFallback = process.env.HUB_API_KEYS_LEGACY_FALLBACK;

function apiKeyRow(
  keyHash: string,
  overrides: Partial<ApiKeyRowFixture> = {},
): ApiKeyRowFixture {
  return {
    id: "key-1",
    org_id: ORG,
    integration_id: "int-1",
    key_hash: keyHash,
    scopes: ["tools:read", "jobs:read"],
    signing_secret_ref: "key-1",
    expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  fake.state.configured = true;
  fake.state.tableExists = true;
  fake.state.apiKeys = [];
  fake.state.integrations = [];
  fake.state.updates = [];
  fake.state.auditInserts = [];
  delete process.env.HUB_API_KEYS_LEGACY_FALLBACK;
});

afterEach(() => {
  if (savedFallback === undefined) {
    delete process.env.HUB_API_KEYS_LEGACY_FALLBACK;
  } else {
    process.env.HUB_API_KEYS_LEGACY_FALLBACK = savedFallback;
  }
});

describe("C5 — caminho da tabela api_keys", () => {
  it("chave válida → identidade api_keys com apiKeyId e ref de assinatura", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.apiKeys = [apiKeyRow(keyHash)];
    const identity = await verifyApiKey(rawKey);
    expect(identity).toEqual({
      orgId: ORG,
      scopes: ["tools:read", "jobs:read"],
      integrationId: "int-1",
      apiKeyId: "key-1",
      signingSecretRef: "key-1",
      keyHash,
      source: "api_keys",
    });
  });

  it("last_used_at: atualiza quando está velho/null; NÃO atualiza dentro do throttle", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.apiKeys = [apiKeyRow(keyHash, { last_used_at: null })];
    await verifyApiKey(rawKey);
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].id).toBe("key-1");
    expect(typeof fake.state.updates[0].patch.last_used_at).toBe("string");

    fake.state.updates = [];
    fake.state.apiKeys = [
      apiKeyRow(keyHash, { last_used_at: new Date().toISOString() }),
    ];
    await verifyApiKey(rawKey);
    expect(fake.state.updates).toHaveLength(0);
  });

  it("chave EXPIRADA → null + auditoria auth.key_expired", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.apiKeys = [
      apiKeyRow(keyHash, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
    ];
    expect(await verifyApiKey(rawKey)).toBeNull();
    expect(fake.state.auditInserts).toHaveLength(1);
    expect(fake.state.auditInserts[0].action).toBe("auth.key_expired");
    expect(fake.state.auditInserts[0].entity_id).toBe("key-1");
  });

  it("chave REVOGADA → null + auditoria, e o legado NÃO a ressuscita", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.apiKeys = [
      apiKeyRow(keyHash, { revoked_at: new Date().toISOString() }),
    ];
    // O mesmo hash continua presente numa integração legada ligada:
    fake.state.integrations = [
      { id: "int-1", org_id: ORG, config: { apiKeyHash: keyHash, scopes: ["tools:read"] } },
    ];
    expect(await verifyApiKey(rawKey)).toBeNull();
    expect(fake.state.auditInserts).toHaveLength(1);
    expect(fake.state.auditInserts[0].action).toBe("auth.key_revoked");
  });

  it("sem integration_id → integrationId é o id da própria chave", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.apiKeys = [apiKeyRow(keyHash, { integration_id: null })];
    const identity = await verifyApiKey(rawKey);
    expect(identity?.integrationId).toBe("key-1");
    expect(identity?.apiKeyId).toBe("key-1");
  });
});

describe("C5 — transição e fallback legado", () => {
  it("pré-0011 (tabela inexistente) → o legado autentica como antes", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.tableExists = false;
    fake.state.integrations = [
      { id: "int-9", org_id: ORG, config: { apiKeyHash: keyHash, scopes: ["jobs:read"] } },
    ];
    const identity = await verifyApiKey(rawKey);
    expect(identity?.source).toBe("legacy");
    expect(identity?.integrationId).toBe("int-9");
    expect(identity?.apiKeyId).toBeUndefined();
  });

  it("tabela existe sem a linha → cai para o legado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    fake.state.integrations = [
      { id: "int-9", org_id: ORG, config: { apiKeyHash: keyHash } },
    ];
    const identity = await verifyApiKey(rawKey);
    expect(identity?.source).toBe("legacy");
  });

  it("HUB_API_KEYS_LEGACY_FALLBACK=false → chave só-legada é recusada", async () => {
    process.env.HUB_API_KEYS_LEGACY_FALLBACK = "false";
    const { rawKey, keyHash } = generateApiKey();
    fake.state.integrations = [
      { id: "int-9", org_id: ORG, config: { apiKeyHash: keyHash } },
    ];
    expect(await verifyApiKey(rawKey)).toBeNull();
  });

  it("chave desconhecida nos dois caminhos → null", async () => {
    const { rawKey } = generateApiKey();
    expect(await verifyApiKey(rawKey)).toBeNull();
  });
});
