/**
 * FASE 2D (C3) — assinatura HMAC + anti-replay persistente.
 *
 * Cobre, com a implementação REAL de lib/api-signing.ts sobre um admin
 * falso (sem rede, sem credenciais):
 *   - o vetor de interoperabilidade da spec §2.4 (a canonicalização tem
 *     de ser byte-idêntica à da Athena — se este vetor quebrar, os dois
 *     lados deixaram de falar a mesma língua);
 *   - ordenação canónica da query (estável, sem re-codificar valores);
 *   - assinatura válida → aceite; corpo adulterado / segredo errado /
 *     formato inválido → 401 genérico; assinatura apresentada sem
 *     segredo resolvível → 401 (nunca ignorada);
 *   - rollout: sem flag, ausência é aceite (e auditada quando a chave
 *     tem segredo); com HUB_REQUIRE_SIGNATURES=true, ausência → 401;
 *   - nonce persistente: insert ok → "persistent"; conflito 23505 →
 *     REPLAY_DETECTED; tabela inexistente (pré-0011) → degradação
 *     "memory-fallback" — e o replay AINDA é apanhado, pela memória;
 *     erro genérico de BD → 500 fail-closed;
 *   - timestamp fora da janela / cabeçalhos em falta → 401;
 *   - X-Key-Id incoerente com a chave → 401.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Fake admin (só as tabelas que lib/api-signing toca)
// ---------------------------------------------------------------------------
type PgError = { code: string; message: string } | null;

const fake = vi.hoisted(() => {
  const state = {
    nonceError: null as PgError,
    nonceInserts: [] as Array<Record<string, unknown>>,
    auditInserts: [] as Array<Record<string, unknown>>,
  };
  const admin = {
    from(table: string) {
      if (table === "api_request_nonces") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.nonceInserts.push(row);
            return { error: state.nonceError };
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
import {
  buildCanonicalString,
  canonicalPathAndQuery,
  cleanupExpiredNonces,
  enforceM2mTransportSecurity,
  resolveSigningSecret,
  signCanonicalString,
  verifyCanonicalSignature,
} from "@/lib/api-signing";
import { sha256Hex, type ApiKeyIdentity } from "@/lib/api-keys";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SECRET = "hub_sign_segredo-de-teste";
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const identity: ApiKeyIdentity = {
  orgId: "org-1",
  scopes: ["jobs:write"],
  integrationId: "int-1",
  apiKeyId: KEY_ID,
  signingSecretRef: KEY_ID,
  keyHash: "fingerprint",
  source: "api_keys",
};

const ENV_KEYS = [
  "HUB_SIGNING_SECRETS_JSON",
  "HUB_REQUIRE_SIGNATURES",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  fake.state.nonceError = null;
  fake.state.nonceInserts = [];
  fake.state.auditInserts = [];
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.HUB_SIGNING_SECRETS_JSON = JSON.stringify({ [KEY_ID]: SECRET });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

let nonceCounter = 0;
function uniqueNonce(): string {
  nonceCounter += 1;
  return `nonce-${nonceCounter}-${Date.now()}`;
}

interface SignedRequestOpts {
  body?: string;
  secret?: string;
  timestamp?: number;
  nonce?: string;
  sign?: boolean;
  extraHeaders?: Record<string, string>;
}

/** Constrói um pedido e (por omissão) assina-o corretamente. */
function buildRequest(opts: SignedRequestOpts = {}): NextRequest {
  const url = new URL("http://localhost/api/v1/athena/missions");
  const body = opts.body ?? "";
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? uniqueNonce();
  const headers: Record<string, string> = {
    "x-request-timestamp": ts,
    "x-nonce": nonce,
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.sign !== false) {
    const canonical = buildCanonicalString({
      method: "POST",
      pathAndQuery: canonicalPathAndQuery(url),
      timestamp: ts,
      nonce,
      body,
    });
    headers["x-signature"] = signCanonicalString(
      opts.secret ?? SECRET,
      canonical,
    );
  }
  return new NextRequest(url, { method: "POST", headers, body });
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

// ===========================================================================
// Vetor de interoperabilidade (spec §2.4) — a prova byte-idêntica
// ===========================================================================
describe("C3 — vetor de interoperabilidade da spec §2.4", () => {
  it("reproduz a assinatura esperada com os valores de exemplo", () => {
    const body =
      '{"mission_id":"00000000-0000-4000-8000-000000000000","tool_slug":"vectorcraft","params":{}}';
    expect(sha256Hex(body)).toBe(
      "66732d18485654563c5be90b87ea028536bf7ccc78f4a910321cf810a8844b86",
    );
    const canonical = buildCanonicalString({
      method: "POST",
      pathAndQuery: "/api/v1/athena/missions",
      timestamp: "1760000000",
      nonce: "11111111-2222-4333-8444-555555555555",
      body,
    });
    expect(canonical).toBe(
      "POST\n/api/v1/athena/missions\n1760000000\n11111111-2222-4333-8444-555555555555\n66732d18485654563c5be90b87ea028536bf7ccc78f4a910321cf810a8844b86",
    );
    expect(
      signCanonicalString("EXEMPLO-segredo-de-assinatura-nao-usar", canonical),
    ).toBe("2dd81aecd970b396cfa7c49e24b23727c128045fb6dfb2abc203dd0adbb7a187");
  });

  it("corpo vazio assina com o hash da string vazia", () => {
    const canonical = buildCanonicalString({
      method: "GET",
      pathAndQuery: "/api/v1/tools",
      timestamp: "1760000000",
      nonce: "n-1",
      body: "",
    });
    expect(canonical.split("\n")[4]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("C3 — canonicalPathAndQuery", () => {
  it("ordena por chave, estável em chaves repetidas, sem re-codificar", () => {
    const url = new URL("http://x/api/v1/tools?b=2&a=1&b=3&q=a%20b");
    expect(canonicalPathAndQuery(url)).toBe(
      "/api/v1/tools?a=1&b=2&b=3&q=a%20b",
    );
  });

  it("sem query devolve só o path", () => {
    expect(canonicalPathAndQuery(new URL("http://x/api/v1/tools"))).toBe(
      "/api/v1/tools",
    );
  });
});

describe("C3 — verifyCanonicalSignature", () => {
  const canonical = "POST\n/api/v1/x\n1\nn\nhash";
  it("aceita a assinatura correta e recusa adulterações", () => {
    const sig = signCanonicalString(SECRET, canonical);
    expect(verifyCanonicalSignature(SECRET, canonical, sig)).toBe(true);
    expect(verifyCanonicalSignature(SECRET, canonical + " ", sig)).toBe(false);
    expect(verifyCanonicalSignature("outro-segredo", canonical, sig)).toBe(false);
    expect(verifyCanonicalSignature(SECRET, canonical, "nao-e-hex")).toBe(false);
    expect(verifyCanonicalSignature(SECRET, canonical, "abcd")).toBe(false);
  });
});

describe("C3 — resolveSigningSecret", () => {
  it("resolve pela referência; devolve null sem mapa/ref/JSON válido", () => {
    expect(resolveSigningSecret(KEY_ID)).toBe(SECRET);
    expect(resolveSigningSecret("ref-inexistente")).toBeNull();
    process.env.HUB_SIGNING_SECRETS_JSON = "{json-invalido";
    expect(resolveSigningSecret(KEY_ID)).toBeNull();
    delete process.env.HUB_SIGNING_SECRETS_JSON;
    expect(resolveSigningSecret(KEY_ID)).toBeNull();
  });
});

// ===========================================================================
// enforceM2mTransportSecurity — o portão completo
// ===========================================================================
describe("C3 — enforceM2mTransportSecurity", () => {
  it("pedido assinado corretamente → verified + nonce persistente", async () => {
    const req = buildRequest({ body: '{"a":1}' });
    const result = await enforceM2mTransportSecurity(req, identity, "fp");
    expect(result).toEqual({ signature: "verified", nonceStore: "persistent" });
    expect(fake.state.nonceInserts).toHaveLength(1);
    expect(fake.state.nonceInserts[0].api_key_id).toBe(KEY_ID);
  });

  it("corpo adulterado depois de assinar → 401 genérico", async () => {
    const req = buildRequest({ body: '{"a":1}' });
    // Reconstrói o pedido com OUTRO corpo mas a MESMA assinatura.
    const sig = req.headers.get("x-signature")!;
    const tampered = new NextRequest(req.url, {
      method: "POST",
      headers: {
        "x-request-timestamp": req.headers.get("x-request-timestamp")!,
        "x-nonce": req.headers.get("x-nonce")!,
        "x-signature": sig,
      },
      body: '{"a":2}',
    });
    await expectHubError(
      enforceM2mTransportSecurity(tampered, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
    expect(fake.state.nonceInserts).toHaveLength(0);
  });

  it("assinatura com o segredo errado → 401", async () => {
    const req = buildRequest({ secret: "segredo-errado" });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
  });

  it("assinatura presente mas a chave não tem segredo (ref null) → 401, nunca ignorada", async () => {
    const req = buildRequest();
    const semSegredo: ApiKeyIdentity = { ...identity, signingSecretRef: null };
    await expectHubError(
      enforceM2mTransportSecurity(req, semSegredo, "fp"),
      "UNAUTHORIZED",
      401,
    );
  });

  it("assinatura presente mas a ref não resolve no cofre → 401", async () => {
    process.env.HUB_SIGNING_SECRETS_JSON = JSON.stringify({});
    const req = buildRequest();
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
  });

  it("sem assinatura e sem flag → aceite, com auditoria auth.signature_missing", async () => {
    const req = buildRequest({ sign: false });
    const result = await enforceM2mTransportSecurity(req, identity, "fp");
    expect(result.signature).toBe("absent-accepted");
    expect(fake.state.auditInserts).toHaveLength(1);
    expect(fake.state.auditInserts[0].action).toBe("auth.signature_missing");
    expect(fake.state.auditInserts[0].entity_id).toBe(KEY_ID);
  });

  it("sem assinatura, sem flag, chave sem segredo → aceite sem auditoria", async () => {
    const req = buildRequest({ sign: false });
    const semSegredo: ApiKeyIdentity = { ...identity, signingSecretRef: null };
    const result = await enforceM2mTransportSecurity(req, semSegredo, "fp");
    expect(result.signature).toBe("absent-accepted");
    expect(fake.state.auditInserts).toHaveLength(0);
  });

  it("sem assinatura com HUB_REQUIRE_SIGNATURES=true → 401", async () => {
    process.env.HUB_REQUIRE_SIGNATURES = "true";
    const req = buildRequest({ sign: false });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
  });

  it("replay: conflito de PK no insert (23505) → REPLAY_DETECTED 401", async () => {
    fake.state.nonceError = { code: "23505", message: "duplicate key" };
    const req = buildRequest({ sign: false });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "REPLAY_DETECTED",
      401,
    );
  });

  it("pré-0011 (tabela inexistente) → memory-fallback, e o replay é apanhado na mesma", async () => {
    fake.state.nonceError = {
      code: "PGRST205",
      message: "Could not find the table 'public.api_request_nonces' in the schema cache",
    };
    const nonce = uniqueNonce();
    const first = buildRequest({ sign: false, nonce });
    const result = await enforceM2mTransportSecurity(first, identity, "fp");
    expect(result.nonceStore).toBe("memory-fallback");
    // O MESMO nonce outra vez: a BD continua sem a tabela, mas o store em
    // memória (degradação) recusa a repetição.
    const second = buildRequest({ sign: false, nonce });
    await expectHubError(
      enforceM2mTransportSecurity(second, identity, "fp"),
      "REPLAY_DETECTED",
      401,
    );
  });

  it("erro genérico de BD no insert do nonce → 500 fail-closed", async () => {
    fake.state.nonceError = { code: "XX000", message: "boom" };
    const req = buildRequest({ sign: false });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "INTERNAL",
      500,
    );
  });

  it("timestamp fora da janela (±300 s) → 401 antes de qualquer insert", async () => {
    const req = buildRequest({
      sign: false,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
    expect(fake.state.nonceInserts).toHaveLength(0);
  });

  it("sem X-Request-Timestamp/X-Nonce → 401", async () => {
    const req = new NextRequest("http://localhost/api/v1/tools", {
      method: "GET",
    });
    await expectHubError(
      enforceM2mTransportSecurity(req, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
  });

  it("X-Key-Id incoerente com a chave → 401; coerente → passa", async () => {
    const bad = buildRequest({
      sign: false,
      extraHeaders: { "x-key-id": "outra-chave" },
    });
    await expectHubError(
      enforceM2mTransportSecurity(bad, identity, "fp"),
      "UNAUTHORIZED",
      401,
    );
    const good = buildRequest({
      sign: false,
      extraHeaders: { "x-key-id": KEY_ID },
    });
    const result = await enforceM2mTransportSecurity(good, identity, "fp");
    expect(result.nonceStore).toBe("persistent");
  });

  it("cleanupExpiredNonces corre sem erro contra o fake", async () => {
    await expect(cleanupExpiredNonces()).resolves.toEqual({ error: null });
  });
});
