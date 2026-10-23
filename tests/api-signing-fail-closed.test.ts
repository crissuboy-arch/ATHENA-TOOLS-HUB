/**
 * REVISÃO PRÉ-G2 (2026-10-23) — anti-replay persistente: o fallback para
 * memória só existe no mundo pré-0011 COMPROVADO.
 *
 * Antes desta revisão, uma EXCEÇÃO inesperada no insert do nonce caía
 * para o store em memória — ou seja, uma falha de BD depois da
 * migration degradava o anti-replay em silêncio (por instância,
 * efémero) e ainda por cima CONSUMIA o nonce nesse store. Agora:
 *
 *   - exceção no insert → 500 fail-closed, e o nonce NÃO fica registado
 *     em memória (provado trocando para o mundo pré-0011 a seguir: a
 *     primeira utilização real do nonce é aceite);
 *   - erro de permissão no insert (tabela existe) → 500 fail-closed,
 *     sem degradação;
 *   - repetição do mesmo nonce DEPOIS de uma falha a meio do pedido
 *     (o nonce já foi consumido insert-first e o processamento a
 *     jusante falhou) → continua REPLAY_DETECTED, nos dois stores:
 *     a falha não "lava" o nonce.
 *
 * Com a implementação REAL de lib/api-signing.ts sobre um admin falso
 * que simula a PK (api_key_id, nonce) da 0011, injeta erros e lança
 * exceções (sem rede, sem credenciais). Complementa
 * lib/api-signing.test.ts (vetor de interoperabilidade, assinatura,
 * degradação pré-0011 básica, erro genérico → 500).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Fake admin — api_request_nonces com PK simulada + injeção de falhas
// ---------------------------------------------------------------------------
type PgError = { code: string; message: string } | null;

const MISSING_TABLE: PgError = {
  code: "PGRST205",
  message:
    "Could not find the table 'public.api_request_nonces' in the schema cache",
};

const fake = vi.hoisted(() => {
  const state = {
    insertMode: "unique" as "unique" | "error" | "throw",
    insertError: null as PgError,
    consumed: new Set<string>(),
    insertAttempts: 0,
    auditInserts: [] as Array<Record<string, unknown>>,
  };
  const admin = {
    from(table: string) {
      if (table === "api_request_nonces") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.insertAttempts += 1;
            if (state.insertMode === "throw") {
              // Exceção ao nível do cliente (rede) — não um { error }.
              throw new Error("fetch failed: socket hang up");
            }
            if (state.insertMode === "error") {
              return { error: state.insertError };
            }
            // Modo "unique": simula a PK (api_key_id, nonce) da 0011.
            const pk = `${row.api_key_id}:${row.nonce}`;
            if (state.consumed.has(pk)) {
              return {
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "api_request_nonces_pkey"',
                },
              };
            }
            state.consumed.add(pk);
            return { error: null };
          },
          delete: () => ({
            lt: async () => ({ error: null }),
          }),
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
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => fake.admin,
}));

import { HubError } from "@/lib/errors";
import { enforceM2mTransportSecurity } from "@/lib/api-signing";
import type { ApiKeyIdentity } from "@/lib/api-keys";

// ---------------------------------------------------------------------------
// Fixtures — identidade da tabela, SEM segredo (o foco é o nonce)
// ---------------------------------------------------------------------------
const KEY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const identity: ApiKeyIdentity = {
  orgId: "org-1",
  scopes: ["jobs:write"],
  integrationId: "int-1",
  apiKeyId: KEY_ID,
  signingSecretRef: null,
  keyHash: "fingerprint",
  source: "api_keys",
};

let seq = 0;
function unique(what: string): string {
  seq += 1;
  return `${what}-${seq}-${Date.now()}`;
}

function buildRequest(nonce: string): NextRequest {
  const url = new URL("http://localhost/api/v1/athena/missions");
  const ts = String(Math.floor(Date.now() / 1000));
  return new NextRequest(url, {
    method: "POST",
    headers: { "x-request-timestamp": ts, "x-nonce": nonce },
    body: "",
  });
}

async function expectHubError(
  promise: Promise<unknown>,
  code: string,
  status: number,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (err: unknown) =>
      err instanceof HubError && err.code === code && err.status === status,
  );
}

/** A falha a jusante: o transporte passou, o processamento rebentou. */
function downstreamFailure(): never {
  throw new Error("falha simulada a jusante (processamento do pedido)");
}

beforeEach(() => {
  fake.state.insertMode = "unique";
  fake.state.insertError = null;
  fake.state.consumed = new Set();
  fake.state.insertAttempts = 0;
  fake.state.auditInserts = [];
  delete process.env.HUB_REQUIRE_SIGNATURES;
  // O aviso de degradação é esperado em dois testes — silencia o ruído.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PRÉ-G2 — insert do nonce: só o pré-0011 comprovado degrada", () => {
  it("EXCEÇÃO ao inserir → 500 fail-closed; o nonce NÃO fica registado em memória", async () => {
    const nonce = unique("nonce");
    const fp = unique("fp");
    fake.state.insertMode = "throw";
    await expectHubError(
      enforceM2mTransportSecurity(buildRequest(nonce), identity, fp),
      "INTERNAL",
      500,
    );
    expect(fake.state.insertAttempts).toBe(1);
    expect(fake.state.consumed.size).toBe(0);

    // Prova de que a exceção NÃO consumiu o nonce no store em memória:
    // no mundo pré-0011 comprovado (tabela inexistente), a PRIMEIRA
    // utilização real deste nonce é aceite via memory-fallback. Se a
    // tentativa falhada o tivesse registado em memória (comportamento
    // antigo), esta repetição seria REPLAY_DETECTED.
    fake.state.insertMode = "error";
    fake.state.insertError = MISSING_TABLE;
    const result = await enforceM2mTransportSecurity(
      buildRequest(nonce),
      identity,
      fp,
    );
    expect(result.nonceStore).toBe("memory-fallback");
  });

  it("erro de PERMISSÃO no insert (42501, tabela existe) → 500 fail-closed, sem degradar", async () => {
    const nonce = unique("nonce");
    const fp = unique("fp");
    fake.state.insertMode = "error";
    fake.state.insertError = {
      code: "42501",
      message: "permission denied for table api_request_nonces",
    };
    await expectHubError(
      enforceM2mTransportSecurity(buildRequest(nonce), identity, fp),
      "INTERNAL",
      500,
    );
    // E também aqui o nonce não foi consumido em lado nenhum:
    fake.state.insertError = MISSING_TABLE;
    const result = await enforceM2mTransportSecurity(
      buildRequest(nonce),
      identity,
      fp,
    );
    expect(result.nonceStore).toBe("memory-fallback");
  });
});

describe("PRÉ-G2 — replay depois de uma falha a meio: a falha não lava o nonce", () => {
  it("store PERSISTENTE: nonce consumido insert-first; falha a jusante; repetição → REPLAY_DETECTED", async () => {
    const nonce = unique("nonce");
    const fp = unique("fp");
    fake.state.insertMode = "unique";

    // 1ª tentativa: o transporte consome o nonce (insert-first)…
    const first = await enforceM2mTransportSecurity(
      buildRequest(nonce),
      identity,
      fp,
    );
    expect(first.nonceStore).toBe("persistent");
    // …e o pedido FALHA a meio, já depois do consumo.
    expect(downstreamFailure).toThrow();

    // Repetição com o mesmo nonce: a falha não pode "lavar" o consumo —
    // a PK devolve 23505 e o pedido é recusado como replay.
    await expectHubError(
      enforceM2mTransportSecurity(buildRequest(nonce), identity, fp),
      "REPLAY_DETECTED",
      401,
    );
  });

  it("store em MEMÓRIA (pré-0011 comprovado): nonce consumido; falha a jusante; repetição → REPLAY_DETECTED", async () => {
    const nonce = unique("nonce");
    const fp = unique("fp");
    fake.state.insertMode = "error";
    fake.state.insertError = MISSING_TABLE;

    const first = await enforceM2mTransportSecurity(
      buildRequest(nonce),
      identity,
      fp,
    );
    expect(first.nonceStore).toBe("memory-fallback");
    expect(downstreamFailure).toThrow();

    await expectHubError(
      enforceM2mTransportSecurity(buildRequest(nonce), identity, fp),
      "REPLAY_DETECTED",
      401,
    );
  });
});
