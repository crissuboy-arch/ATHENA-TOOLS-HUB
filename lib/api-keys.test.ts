/**
 * FASE 1 — verifyApiKey contra o schema REAL.
 *
 * Drift corrigido (achado FASE 11): `verifyApiKey` filtrava
 * `integrations.status = 'active'`, mas o schema real
 * (supabase/migrations/0001_core.sql) NÃO tem coluna `status` na tabela
 * `integrations` — a coluna real é `state` (enum `tool_state`), e o valor que
 * significa "integração ativa" é 'connected'. Contra o schema real, TODA a
 * autenticação machine-to-machine devolvia 401. Nenhum teste cobria
 * verifyApiKey — por isso os 122 testes passavam com o bug.
 *
 * Estes testes usam um mock do Supabase que CAPTURA a coluna filtrada e a
 * valida contra o CREATE TABLE real da migration — se o código voltar a
 * filtrar por uma coluna inexistente, o teste quebra.
 *
 * Nenhum teste toca rede ou credenciais reais.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateApiKey, verifyApiKey } from "@/lib/api-keys";

interface CapturedFilter {
  table: string;
  column: string;
  value: unknown;
}

interface QueryState {
  table: string | null;
  filters: CapturedFilter[];
  rows: Array<Record<string, unknown>>;
  error: { message: string } | null;
  configured: boolean;
}

const { queryState, fakeSupabase } = vi.hoisted(() => {
  const queryState: QueryState = {
    table: null,
    filters: [],
    rows: [],
    error: null,
    configured: true,
  };
  const fakeSupabase = {
    from(table: string) {
      queryState.table = table;
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              // FASE 2D: o filtro fica atribuído à tabela do from() — a
              // verificação consulta api_keys ANTES do legado, e os testes
              // distinguem os dois caminhos.
              queryState.filters.push({ table, column, value });
              const state = queryState;
              return {
                then(
                  resolve: (
                    v: unknown,
                  ) => void,
                ) {
                  if (state.error) resolve({ data: null, error: state.error });
                  else resolve({ data: state.rows, error: null });
                },
                // REVISÃO PRÉ-G2: o mundo simulado por esta suite é
                // PRÉ-0011 — `api_keys` ainda não existe. Antes, o fake
                // não tinha maybeSingle e a consulta morria com um
                // TypeError que o soft-fail antigo mascarava como
                // "indisponível"; com a classificação explícita de
                // erros (só tabela comprovadamente inexistente abre o
                // legado), o fake declara honestamente o mundo que
                // simula: PGRST205. Nenhuma asserção desta suite muda —
                // o comportamento esperado sempre foi o pré-0011.
                maybeSingle: async () => {
                  if (table === "api_keys") {
                    return {
                      data: null,
                      error: {
                        code: "PGRST205",
                        message:
                          "Could not find the table in the schema cache",
                      },
                    };
                  }
                  if (state.error) return { data: null, error: state.error };
                  return { data: state.rows[0] ?? null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { queryState, fakeSupabase };
});

/** Filtros capturados de UMA tabela (desde a 2D há dois caminhos). */
function filtersFor(table: string): CapturedFilter[] {
  return queryState.filters.filter((f) => f.table === table);
}

vi.mock("@/lib/auth", () => ({
  isSupabaseConfigured: () => queryState.configured,
  getSupabaseAdmin: () => fakeSupabase as unknown as SupabaseClient,
}));

/** Colunas reais de uma tabela segundo o SQL de uma migration (schema real). */
function tableColumnsFromSql(sql: string, table: string): string[] {
  const block = new RegExp(
    `CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
  ).exec(sql)?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("--") &&
        !line.startsWith("CONSTRAINT") &&
        !line.startsWith("PRIMARY"),
    )
    .map((line) => line.split(/\s+/)[0].replace(/["`,]/g, ""))
    .filter(Boolean);
}

/** Colunas reais de uma tabela segundo a migration 0001 (fonte: schema real). */
function realTableColumns(table: string): string[] {
  return tableColumnsFromSql(
    readFileSync("supabase/migrations/0001_core.sql", "utf8"),
    table,
  );
}

beforeEach(() => {
  queryState.table = null;
  queryState.filters = [];
  queryState.rows = [];
  queryState.error = null;
  queryState.configured = true;
});

describe("verifyApiKey — filtro alinhado ao schema real", () => {
  it("filtra integrations pela coluna REAL `state` = 'connected' (nunca `status`)", async () => {
    const { rawKey, keyHash } = generateApiKey();
    queryState.rows = [
      {
        id: "int-1",
        org_id: "org-1",
        config: { apiKeyHash: keyHash, scopes: ["tools:read"] },
      },
    ];

    const identity = await verifyApiKey(rawKey);

    expect(identity).toEqual({
      orgId: "org-1",
      scopes: ["tools:read"],
      integrationId: "int-1",
      keyHash,
      source: "legacy",
    });
    // FASE 2D: a tabela nova é consultada PRIMEIRO (por key_hash, coluna
    // real da 0011) e o legado continua a ser a rede de segurança.
    const apiKeysFilters = filtersFor("api_keys");
    expect(apiKeysFilters).toHaveLength(1);
    expect(apiKeysFilters[0].column).toBe("key_hash");
    expect(apiKeysFilters[0].value).toBe(keyHash);
    const apiKeysColumns = tableColumnsFromSql(
      readFileSync("supabase/migrations/0011_api_keys.sql", "utf8"),
      "api_keys",
    );
    expect(apiKeysColumns).toContain("key_hash");

    expect(queryState.table).toBe("integrations");
    const integrationFilters = filtersFor("integrations");
    expect(integrationFilters).toHaveLength(1);
    const [filter] = integrationFilters;
    expect(filter.value).toBe("connected");

    // A coluna filtrada TEM de existir no schema real — é aqui que o drift
    // antigo (`status`) seria apanhado.
    const realColumns = realTableColumns("integrations");
    expect(realColumns).toContain("state");
    expect(realColumns).toContain(filter.column);
    expect(realColumns).not.toContain("status");
  });

  it("retorna null para chave desconhecida", async () => {
    const { rawKey } = generateApiKey();
    queryState.rows = [];
    expect(await verifyApiKey(rawKey)).toBeNull();
    expect(filtersFor("integrations")[0]?.column).toBe("state");
  });

  it("retorna null quando o Supabase devolve erro", async () => {
    const { rawKey } = generateApiKey();
    queryState.error = { message: "boom" };
    expect(await verifyApiKey(rawKey)).toBeNull();
  });

  it("ignora linhas com apiKeyHash inválido sem quebrar", async () => {
    const { rawKey } = generateApiKey();
    queryState.rows = [
      {
        id: "int-x",
        org_id: "org-x",
        config: { apiKeyHash: "nao-e-hex", scopes: [] },
      },
    ];
    expect(await verifyApiKey(rawKey)).toBeNull();
  });

  it("retorna null sem Supabase configurado (sem tocar na rede)", async () => {
    queryState.configured = false;
    const { rawKey } = generateApiKey();
    expect(await verifyApiKey(rawKey)).toBeNull();
    expect(queryState.table).toBeNull();
  });

  it("retorna null para chave vazia", async () => {
    expect(await verifyApiKey("")).toBeNull();
    expect(queryState.table).toBeNull();
  });
});

describe("generateApiKey — formato", () => {
  it("gera par rawKey/keyHash consistente (sha256 hex)", async () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(rawKey.startsWith("hub_live_")).toBe(true);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    // O hash gerado autentica de volta contra o mock.
    queryState.rows = [
      { id: "int-9", org_id: "org-9", config: { apiKeyHash: keyHash } },
    ];
    const identity = await verifyApiKey(rawKey);
    expect(identity?.integrationId).toBe("int-9");
    expect(identity?.scopes).toEqual([]);
  });
});
