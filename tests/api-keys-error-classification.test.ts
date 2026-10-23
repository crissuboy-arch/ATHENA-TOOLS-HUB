/**
 * REVISÃO PRÉ-G2 (2026-10-23) — classificação de erros na consulta à
 * tabela `api_keys` (lib/api-keys.ts, verifyApiKey).
 *
 * A regra apertada nesta revisão: o fallback legado só abre quando a
 * tabela está COMPROVADAMENTE inexistente (mundo pré-0011). Erros de
 * conexão, de permissão, genéricos de consulta e exceções do cliente
 * são FAIL-CLOSED (HubError 500) — um erro de BD a meio da transição
 * não pode rebaixar a autenticação para o caminho antigo em silêncio.
 *
 * Com a implementação REAL sobre um admin falso que injeta cada classe
 * de erro (sem rede, sem credenciais). Em todos os cenários de erro, a
 * integração legada CONTÉM o hash da chave apresentada: se o fallback
 * abrisse indevidamente, a chave autenticava — é isso que estes testes
 * provam que não acontece (a contagem de consultas ao legado fica a 0).
 *
 * Complementa tests/api-keys-table-auth.test.ts (caminho feliz,
 * revogada/expirada decisivas, pré-0011 via PGRST205).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake admin com injeção de erros na tabela api_keys
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

type PgErrorLike = { code?: string; message?: string } | null;

const fake = vi.hoisted(() => {
  const state = {
    configured: true,
    apiKeysMode: "rows" as "rows" | "error" | "throw",
    apiKeysError: null as PgErrorLike,
    apiKeys: [] as ApiKeyRowFixture[],
    integrations: [] as Array<{
      id: string;
      org_id: string;
      config: { apiKeyHash?: string; scopes?: string[] } | null;
    }>,
    integrationsQueries: 0,
    auditThrows: false,
    auditInserts: [] as Array<Record<string, unknown>>,
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
                    if (state.apiKeysMode === "throw") {
                      // Falha de rede ao nível do cliente (fetch) — o
                      // supabase-js lança em vez de devolver { error }.
                      throw new Error("fetch failed: connection reset");
                    }
                    if (state.apiKeysMode === "error") {
                      return { data: null, error: state.apiKeysError };
                    }
                    const row =
                      state.apiKeys.find((k) => k.key_hash === val) ?? null;
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          update() {
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      if (table === "integrations") {
        return {
          select() {
            return {
              eq: async () => {
                state.integrationsQueries += 1;
                return { data: state.integrations, error: null };
              },
            };
          },
        };
      }
      if (table === "audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (state.auditThrows) {
              throw new Error("audit_logs indisponível");
            }
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

import { HubError } from "@/lib/errors";
import { generateApiKey, verifyApiKey } from "@/lib/api-keys";

const ORG = "22222222-2222-4222-8222-222222222222";
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

/** A armadilha: o MESMO hash existe numa integração legada ligada. */
function armLegacyTrap(keyHash: string): void {
  fake.state.integrations = [
    {
      id: "int-legada",
      org_id: ORG,
      config: { apiKeyHash: keyHash, scopes: ["tools:read"] },
    },
  ];
}

async function expectFailClosed500(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (err: unknown) =>
      err instanceof HubError && err.code === "INTERNAL" && err.status === 500,
  );
}

beforeEach(() => {
  fake.state.configured = true;
  fake.state.apiKeysMode = "rows";
  fake.state.apiKeysError = null;
  fake.state.apiKeys = [];
  fake.state.integrations = [];
  fake.state.integrationsQueries = 0;
  fake.state.auditThrows = false;
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

describe("PRÉ-G2 — erros de BD na api_keys NÃO abrem o legado (fail-closed)", () => {
  it("erro de CONEXÃO (08006) → 500, legado nunca consultado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    fake.state.apiKeysError = {
      code: "08006",
      message: "Connection terminated unexpectedly",
    };
    await expectFailClosed500(verifyApiKey(rawKey));
    expect(fake.state.integrationsQueries).toBe(0);
  });

  it("erro de PERMISSÃO (42501) → 500, legado nunca consultado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    fake.state.apiKeysError = {
      code: "42501",
      message: "permission denied for table api_keys",
    };
    await expectFailClosed500(verifyApiKey(rawKey));
    expect(fake.state.integrationsQueries).toBe(0);
  });

  it("EXCEÇÃO do cliente na consulta (rede) → 500, legado nunca consultado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "throw";
    await expectFailClosed500(verifyApiKey(rawKey));
    expect(fake.state.integrationsQueries).toBe(0);
  });

  it("erro GENÉRICO de consulta (XX000) → 500, legado nunca consultado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    fake.state.apiKeysError = { code: "XX000", message: "internal error" };
    await expectFailClosed500(verifyApiKey(rawKey));
    expect(fake.state.integrationsQueries).toBe(0);
  });
});

describe("PRÉ-G2 — tabela COMPROVADAMENTE inexistente mantém a compatibilidade", () => {
  it("42P01 (relation does not exist) → o legado autentica como antes", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    fake.state.apiKeysError = {
      code: "42P01",
      message: 'relation "public.api_keys" does not exist',
    };
    const identity = await verifyApiKey(rawKey);
    expect(identity?.source).toBe("legacy");
    expect(identity?.integrationId).toBe("int-legada");
    expect(fake.state.integrationsQueries).toBe(1);
  });

  it("PGRST205 (schema cache) → o legado autentica como antes", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    fake.state.apiKeysError = {
      code: "PGRST205",
      message: "Could not find the table in the schema cache",
    };
    const identity = await verifyApiKey(rawKey);
    expect(identity?.source).toBe("legacy");
    expect(fake.state.integrationsQueries).toBe(1);
  });

  it("mensagem inequívoca 'relation … does not exist' → classificado como tabela inexistente", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeysMode = "error";
    // Código não relacionado: é a MENSAGEM inequívoca que classifica.
    fake.state.apiKeysError = {
      code: "PGRST000",
      message: 'relation "api_keys" does not exist',
    };
    const identity = await verifyApiKey(rawKey);
    expect(identity?.source).toBe("legacy");
    expect(fake.state.integrationsQueries).toBe(1);
  });
});

describe("PRÉ-G2 — chave revogada: decisiva mesmo com falhas à volta", () => {
  // O caso base (revogada + mesmo hash no legado → null) já está provado
  // em tests/api-keys-table-auth.test.ts. Esta é a variante com erro de
  // BD: a auditoria da rejeição FALHA (lança) — a rejeição tem de se
  // manter e o legado nem sequer é consultado.
  it("revogada + auditoria a falhar → continua recusada, legado nunca consultado", async () => {
    const { rawKey, keyHash } = generateApiKey();
    armLegacyTrap(keyHash);
    fake.state.apiKeys = [
      apiKeyRow(keyHash, { revoked_at: new Date().toISOString() }),
    ];
    fake.state.auditThrows = true;
    expect(await verifyApiKey(rawKey)).toBeNull();
    expect(fake.state.integrationsQueries).toBe(0);
  });
});
