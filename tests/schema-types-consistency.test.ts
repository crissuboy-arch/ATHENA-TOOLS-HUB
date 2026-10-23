/**
 * FASE 2C (C6) — consistência schema (migrations) ↔ tipos TypeScript.
 *
 * `lib/db-types.ts` é escrito à mão e historicamente só espelhava a
 * migration 0001 (14/25 tabelas sem tipo, 5 enums e 2 colunas em falta —
 * drift medido na Fase 1). Este teste é o anti-drift: deriva tabelas,
 * colunas, enums e funções DIRETAMENTE do SQL das migrations 0001–0011 e
 * compara-os, nos dois sentidos, com o que `lib/db-types.ts` declara.
 *
 * Se uma migration futura mudar o schema sem atualizar os tipos (ou os
 * tipos forem editados sem migration), este teste falha com a lista
 * exata das divergências. Não é um instantâneo decorativo: nada aqui está
 * hardcoded exceto as contagens-âncora do âmbito 0001–0011 (27 tabelas,
 * 11 enums, 8 funções únicas — bootstrap_organization tem 2 definições
 * CREATE, em 0002 e 0005, e conta uma vez). A 0011 (api_keys +
 * api_request_nonces, FASE 2D) está PREPARADA e não aplicada — o teste
 * deriva do ficheiro, não da BD viva, por isso cobre-a já.
 *
 * Nenhum teste toca rede, BD ou credenciais — só lê ficheiros do repo.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Leitura das fontes
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const sqlAll = migrationFiles
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");
const tsSource = readFileSync(join(process.cwd(), "lib/db-types.ts"), "utf8");

// ---------------------------------------------------------------------------
// Parsing do SQL — tabelas, colunas, enums, funções
// ---------------------------------------------------------------------------

interface SqlColumn {
  type: string; // tipo PG normalizado (ex.: 'uuid', 'public.tool_state', 'numeric(5, 2)')
  nullable: boolean;
}

function cutPgType(def: string): string {
  const cutters = [
    " NOT NULL",
    " DEFAULT",
    " REFERENCES",
    " PRIMARY KEY",
    " UNIQUE",
    " CHECK",
  ];
  let end = def.length;
  for (const c of cutters) {
    const i = def.indexOf(c);
    if (i !== -1 && i < end) end = i;
  }
  return def.slice(0, end).trim().replace(/\s+/g, " ");
}

function parseSqlTables(sql: string): Map<string, Map<string, SqlColumn>> {
  const tables = new Map<string, Map<string, SqlColumn>>();
  const createRe =
    /CREATE TABLE IF NOT EXISTS public\.(\w+) \(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(createRe)) {
    const [, name, body] = m;
    const cols = new Map<string, SqlColumn>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.split("--")[0].trim();
      if (!line) continue;
      if (
        /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/.test(line)
      ) {
        continue;
      }
      const nameMatch = line.match(/^(\w+)\s+(.*)$/);
      if (!nameMatch) continue;
      const [, colName, defRaw] = nameMatch;
      const def = defRaw.replace(/,$/, "").trim();
      cols.set(colName, {
        type: cutPgType(def),
        nullable: !(def.includes("NOT NULL") || def.includes("PRIMARY KEY")),
      });
    }
    tables.set(name, cols);
  }
  // ALTER TABLE … ADD COLUMN (0004 tool_slug, 0007 category_id)
  const alterRe =
    /ALTER TABLE public\.(\w+)\s+ADD COLUMN IF NOT EXISTS (\w+) ([^;]+);/g;
  for (const m of sql.matchAll(alterRe)) {
    const [, table, colName, defRaw] = m;
    const cols = tables.get(table);
    if (!cols) throw new Error(`ALTER sobre tabela desconhecida: ${table}`);
    const def = defRaw.trim();
    cols.set(colName, {
      type: cutPgType(def),
      nullable: !(def.includes("NOT NULL") || def.includes("PRIMARY KEY")),
    });
  }
  return tables;
}

function parseSqlEnums(sql: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const re = /CREATE TYPE public\.(\w+) AS ENUM \(([\s\S]*?)\)/g;
  for (const m of sql.matchAll(re)) {
    const values = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
    enums.set(m[1], values);
  }
  return enums;
}

interface SqlFunction {
  args: Array<{ name: string; type: string }>;
  returns: string;
}

function parseSqlFunctions(sql: string): Map<string, SqlFunction> {
  const fns = new Map<string, SqlFunction>();
  const re =
    /CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)\s*RETURNS\s+([^\n;]+)/g;
  for (const m of sql.matchAll(re)) {
    const argStr = m[2].trim();
    const args =
      argStr === ""
        ? []
        : argStr.split(",").map((a) => {
            const parts = a.trim().split(/\s+/);
            return { name: parts[0], type: parts.slice(1).join(" ") };
          });
    // Definições posteriores substituem as anteriores (ex.:
    // bootstrap_organization em 0002 → 0005): a última ganha.
    fns.set(m[1], { args, returns: m[3].trim() });
  }
  return fns;
}

// ---------------------------------------------------------------------------
// Parsing de lib/db-types.ts
// ---------------------------------------------------------------------------

function parseTsInterfaces(src: string): Map<string, Map<string, string>> {
  const ifaces = new Map<string, Map<string, string>>();
  const re = /export interface (\w+) \{([\s\S]*?)\n\}/g;
  for (const m of src.matchAll(re)) {
    const props = new Map<string, string>();
    for (const line of m[2].split("\n")) {
      const pm = line.match(/^\s+(\w+)(\?)?:\s*(.+);\s*$/);
      if (pm) props.set(pm[1], pm[3].trim());
    }
    ifaces.set(m[1], props);
  }
  return ifaces;
}

function parseTsTablesMap(src: string): Map<string, string> {
  const block = src.match(/export type Tables = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("Bloco `export type Tables` não encontrado");
  const map = new Map<string, string>();
  for (const m of block[1].matchAll(/(\w+): (\w+);/g)) map.set(m[1], m[2]);
  return map;
}

function parseTsEnumsRegistry(src: string): Map<string, string> {
  const block = src.match(/Enums: \{([\s\S]*?)\n    \};/);
  if (!block) throw new Error("Bloco `Enums` não encontrado em Database");
  const map = new Map<string, string>();
  for (const m of block[1].matchAll(/(\w+): (\w+);/g)) map.set(m[1], m[2]);
  return map;
}

function parseTsEnumValues(src: string, typeName: string): string[] {
  const start = src.indexOf(`export type ${typeName} =`);
  if (start === -1) throw new Error(`Tipo enum ${typeName} não encontrado`);
  const end = src.indexOf(";", start);
  const segment = src.slice(start, end);
  return [...segment.matchAll(/'([^']+)'/g)].map((v) => v[1]);
}

interface TsFunction {
  args: Array<{ name: string; type: string }>;
  returns: string;
}

function parseTsFunctions(src: string): Map<string, TsFunction> {
  const block = src.match(/Functions: \{([\s\S]*?)\n    \};/);
  if (!block) throw new Error("Bloco `Functions` não encontrado em Database");
  const fns = new Map<string, TsFunction>();
  const entryRe =
    /(\w+): \{\s+Args: ([\s\S]+?);\s+Returns: ([^;]+);\s+\};/g;
  for (const m of block[1].matchAll(entryRe)) {
    const argsText = m[2].trim();
    let args: Array<{ name: string; type: string }> = [];
    if (argsText !== "Record<string, never>") {
      const inner = argsText.replace(/^\{\s*/, "").replace(/\s*\}$/, "");
      args = inner
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf(":");
          return {
            name: pair.slice(0, idx).trim(),
            type: pair.slice(idx + 1).trim(),
          };
        });
    }
    fns.set(m[1], { args, returns: m[3].trim() });
  }
  return fns;
}

// ---------------------------------------------------------------------------
// Mapeamento PG → categoria TS comparável
// ---------------------------------------------------------------------------

/** Categoria comparável de um tipo PG de coluna. */
function pgColumnCategory(pgType: string): string {
  const t = pgType.replace(/\s+/g, "");
  if (t === "uuid" || t === "text" || t === "timestamptz") return "string";
  if (t === "integer" || t === "bigint" || t.startsWith("numeric"))
    return "number";
  if (t === "boolean") return "boolean";
  if (t === "text[]") return "string[]";
  if (t === "jsonb") return "json";
  if (t.startsWith("public.")) return `enum:${t.slice("public.".length)}`;
  throw new Error(`Tipo PG sem mapeamento no teste: ${pgType}`);
}

/** Categoria comparável de um tipo TS declarado numa row. */
function tsColumnCategory(
  tsType: string,
  enumTsToSql: Map<string, string>,
): string {
  const base = tsType.replace(/\s*\|\s*null$/, "").trim();
  if (base === "string") return "string";
  if (base === "number") return "number";
  if (base === "boolean") return "boolean";
  if (base === "string[]") return "string[]";
  const sqlEnum = enumTsToSql.get(base);
  if (sqlEnum) return `enum:${sqlEnum}`;
  // jsonb é representado por Record<string, unknown> ou pelas shapes
  // nomeadas (IntegrationTestResult, JobError, AuditDiff).
  return "json";
}

function pgFnTypeCategory(pgType: string): string {
  const t = pgType.trim().replace(/\s+/g, " ");
  if (t === "uuid" || t === "text") return "string";
  if (t === "text[]") return "string[]";
  if (t === "boolean") return "boolean";
  if (t === "void") return "void";
  if (t === "SETOF uuid") return "string[]";
  if (t === "trigger") return "trigger";
  throw new Error(`Tipo PG de função sem mapeamento no teste: ${pgType}`);
}

function tsFnTypeCategory(tsType: string): string {
  const t = tsType.trim();
  if (t === "unknown") return "trigger";
  return t; // 'string' | 'string[]' | 'boolean' | 'void' já são categorias
}

// ---------------------------------------------------------------------------
// Estruturas derivadas
// ---------------------------------------------------------------------------

const sqlTables = parseSqlTables(sqlAll);
const sqlEnums = parseSqlEnums(sqlAll);
const sqlFunctions = parseSqlFunctions(sqlAll);

const tsInterfaces = parseTsInterfaces(tsSource);
const tsTablesMap = parseTsTablesMap(tsSource);
const tsEnumsRegistry = parseTsEnumsRegistry(tsSource);
const tsFunctions = parseTsFunctions(tsSource);
const enumTsToSql = new Map(
  [...tsEnumsRegistry.entries()].map(([sql, ts]) => [ts, sql]),
);

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("C6/2D — tipos TS espelham as migrations 0001–0011", () => {
  it("as 27 tabelas das migrations existem no mapa Tables (e vice-versa)", () => {
    expect([...sqlTables.keys()].sort()).toEqual(
      [...tsTablesMap.keys()].sort(),
    );
    expect(sqlTables.size).toBe(27);
  });

  it("cada tabela tem exatamente as colunas da migration, com tipo e nulidade certos", () => {
    const problems: string[] = [];
    for (const [table, sqlCols] of sqlTables) {
      const ifaceName = tsTablesMap.get(table);
      if (!ifaceName) {
        problems.push(`${table}: sem entrada no mapa Tables`);
        continue;
      }
      const tsProps = tsInterfaces.get(ifaceName);
      if (!tsProps) {
        problems.push(`${table}: interface ${ifaceName} não encontrada`);
        continue;
      }
      const sqlNames = [...sqlCols.keys()].sort();
      const tsNames = [...tsProps.keys()].sort();
      if (JSON.stringify(sqlNames) !== JSON.stringify(tsNames)) {
        problems.push(
          `${table}: colunas SQL [${sqlNames.join(", ")}] ≠ TS [${tsNames.join(", ")}]`,
        );
        continue;
      }
      for (const [col, sqlCol] of sqlCols) {
        const tsType = tsProps.get(col)!;
        const tsNullable = /\|\s*null$/.test(tsType.trim());
        if (tsNullable !== sqlCol.nullable) {
          problems.push(
            `${table}.${col}: nulidade SQL nullable=${sqlCol.nullable} ≠ TS nullable=${tsNullable}`,
          );
        }
        const sqlCat = pgColumnCategory(sqlCol.type);
        const tsCat = tsColumnCategory(tsType, enumTsToSql);
        if (sqlCat !== tsCat) {
          problems.push(
            `${table}.${col}: tipo SQL ${sqlCol.type} (${sqlCat}) ≠ TS ${tsType} (${tsCat})`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("os 11 enums das migrations existem no registo Enums, com os mesmos valores", () => {
    expect([...sqlEnums.keys()].sort()).toEqual(
      [...tsEnumsRegistry.keys()].sort(),
    );
    expect(sqlEnums.size).toBe(11);
    for (const [sqlName, values] of sqlEnums) {
      const tsName = tsEnumsRegistry.get(sqlName)!;
      expect(parseTsEnumValues(tsSource, tsName), `enum ${sqlName}`).toEqual(
        values,
      );
    }
  });

  it("as funções das migrations existem no registo Functions, com args e retorno certos", () => {
    expect([...sqlFunctions.keys()].sort()).toEqual(
      [...tsFunctions.keys()].sort(),
    );
    // 9 statements CREATE FUNCTION; bootstrap_organization é definida em
    // 0002 e substituída em 0005 → 8 funções únicas.
    expect(sqlFunctions.size).toBe(8);
    for (const [name, sqlFn] of sqlFunctions) {
      const tsFn = tsFunctions.get(name)!;
      expect(
        tsFn.args.map((a) => ({
          name: a.name,
          type: tsFnTypeCategory(a.type),
        })),
        `função ${name}: args`,
      ).toEqual(
        sqlFn.args.map((a) => ({
          name: a.name,
          type: pgFnTypeCategory(a.type),
        })),
      );
      expect(tsFnTypeCategory(tsFn.returns), `função ${name}: retorno`).toBe(
        pgFnTypeCategory(sqlFn.returns),
      );
    }
  });

  it("as colunas adicionadas por ALTER (0004/0007) estão tipadas", () => {
    // Regressão direta do drift medido na Fase 1.
    const job = tsInterfaces.get(tsTablesMap.get("execution_jobs")!)!;
    expect(job.get("tool_slug")).toBe("string | null");
    const tool = tsInterfaces.get(tsTablesMap.get("tools")!)!;
    expect(tool.get("category_id")).toBe("string | null");
  });

  it("as tabelas da 0011 (api_keys, api_request_nonces) estão tipadas", () => {
    // FASE 2D (C5/C3b): a migration está preparada, não aplicada — os
    // tipos descrevem o schema-alvo e este teste impede que a 0011 e
    // lib/db-types.ts voltem a divergir.
    const apiKey = tsInterfaces.get(tsTablesMap.get("api_keys")!)!;
    expect(apiKey.get("key_hash")).toBe("string");
    expect(apiKey.get("scopes")).toBe("string[]");
    expect(apiKey.get("integration_id")).toBe("string | null");
    expect(apiKey.get("signing_secret_ref")).toBe("string | null");
    expect(apiKey.get("expires_at")).toBe("string | null");
    expect(apiKey.get("revoked_at")).toBe("string | null");
    expect(apiKey.get("replaced_by_id")).toBe("string | null");
    const nonce = tsInterfaces.get(tsTablesMap.get("api_request_nonces")!)!;
    expect(nonce.get("api_key_id")).toBe("string");
    expect(nonce.get("nonce")).toBe("string");
    expect(nonce.get("request_ts")).toBe("string");
    expect(nonce.get("expires_at")).toBe("string");
  });
});
