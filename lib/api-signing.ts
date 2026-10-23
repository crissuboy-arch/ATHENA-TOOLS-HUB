/**
 * Athena Tools Hub — FASE 2D (C3): assinatura HMAC + anti-replay
 * persistente para pedidos machine-to-machine com chaves da tabela
 * `api_keys`. Implementa docs/FASE2C_C3_C5_SPEC.md §§2–3 com as decisões
 * ratificadas pela Cristiane:
 *
 *   - Opção A: segredo de assinatura DEDICADO (hub_sign_…), distinto da
 *     chave Bearer. O Hub guarda só a REFERÊNCIA (api_keys.
 *     signing_secret_ref — por desenho, o próprio id da chave); o valor
 *     vive no cofre/servidor: HUB_SIGNING_SECRETS_JSON, um objeto JSON
 *     { "<ref>": "<segredo>" } no ambiente do servidor. A Athena guarda
 *     a sua cópia no vault dela. Sem segredo resolvível, uma assinatura
 *     apresentada NÃO pode ser validada → 401 (nunca é ignorada).
 *   - String canónica (§2.1): METHOD\nPATH+QUERY(ordenada)\nTIMESTAMP\n
 *     NONCE\nSHA256_HEX(corpo) — o vetor de interoperabilidade da spec
 *     §2.4 é reproduzido em lib/api-signing.test.ts.
 *   - Rollout C3-1: sem a flag HUB_REQUIRE_SIGNATURES, a assinatura é
 *     opcional — mas, quando presente, é SEMPRE validada; quando ausente
 *     numa chave emitida com segredo, fica registado em audit_logs
 *     (auth.signature_missing). Com a flag ligada (=true), a assinatura
 *     passa a obrigatória para chaves `api_keys` (fase C3-3, gate G4).
 *   - Anti-replay persistente (§3): insert-first em api_request_nonces —
 *     a PK (api_key_id, nonce) impõe a unicidade atomicamente, em todas
 *     as instâncias. DEGRADAÇÃO HONESTA: enquanto a migration 0011 não
 *     for aplicada (tabela inexistente), cai-se para o store em memória
 *     de lib/api-keys.ts e o resultado diz `nonceStore:
 *     "memory-fallback"` — a proteção por instância continua, a
 *     persistente NÃO é fingida. Outros erros de BD falham FECHADOS
 *     (500): sem conseguir registar o nonce, o pedido não é processado.
 *
 * Ordem de validação (spec §3.2): timestamp → assinatura → nonce.
 * Falhas de assinatura devolvem 401 genérico (UNAUTHORIZED) — sem oráculo
 * que distinga chave desconhecida de assinatura inválida.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { HubError } from "./errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "./auth";
import {
  checkReplayProtection,
  isMissingTableError,
  parseReplayHeaders,
  sha256Hex,
  type ApiKeyIdentity,
} from "./api-keys";

/** TTL do nonce persistido: 2× a janela de ±300 s (spec §3.1). */
const NONCE_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// String canónica e assinatura (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * PATH+QUERY canónico: path absoluto + query com parâmetros ordenados por
 * chave (ordenação estável — valores repetidos mantêm a ordem original e
 * a codificação exata que o cliente enviou; nada é re-codificado).
 */
export function canonicalPathAndQuery(url: URL): string {
  const rawQuery = url.search.startsWith("?")
    ? url.search.slice(1)
    : url.search;
  if (!rawQuery) return url.pathname;
  const parts = rawQuery.split("&").filter((p) => p.length > 0);
  const keyed = parts.map((part, index) => ({
    key: part.split("=")[0],
    index,
    part,
  }));
  keyed.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index,
  );
  return `${url.pathname}?${keyed.map((k) => k.part).join("&")}`;
}

export interface CanonicalInput {
  method: string;
  pathAndQuery: string;
  /** String crua do X-Request-Timestamp (não o número parseado). */
  timestamp: string;
  nonce: string;
  /** Corpo exato do pedido ("" quando vazio). */
  body: string;
}

/** A string que é assinada — exatamente a da spec §2.1, sem newline final. */
export function buildCanonicalString(input: CanonicalInput): string {
  return [
    input.method.toUpperCase(),
    input.pathAndQuery,
    input.timestamp,
    input.nonce,
    sha256Hex(input.body),
  ].join("\n");
}

/** HMAC-SHA256 hex minúsculo da string canónica, chaveado pelo segredo. */
export function signCanonicalString(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

/** Comparação em tempo constante; qualquer formato inválido = false. */
export function verifyCanonicalSignature(
  secret: string,
  canonical: string,
  providedHex: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) return false;
  const expected = Buffer.from(signCanonicalString(secret, canonical), "hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// Segredo de assinatura (Opção A) e flag de obrigatoriedade
// ---------------------------------------------------------------------------

/**
 * Resolve a referência do cofre para o valor do segredo.
 * Fonte: HUB_SIGNING_SECRETS_JSON = { "<signing_secret_ref>": "<segredo>" }.
 * Devolve null quando não há mapa, a ref não existe, ou o JSON é inválido
 * (estado honesto: assinatura não verificável — nunca se inventa segredo).
 */
export function resolveSigningSecret(ref: string): string | null {
  const raw = process.env.HUB_SIGNING_SECRETS_JSON;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const value = map[ref];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Fase C3-3: com HUB_REQUIRE_SIGNATURES=true, assinar é obrigatório. */
export function signaturesRequired(): boolean {
  return process.env.HUB_REQUIRE_SIGNATURES === "true";
}

function genericSignatureError(): HubError {
  // Um só erro para "ausente quando obrigatória", "inválida" e "sem
  // segredo para validar": sem oráculo (spec §2.3).
  return HubError.unauthorized("Assinatura do pedido inválida ou ausente.");
}

// ---------------------------------------------------------------------------
// Aplicação por pedido (chamado por lib/api-auth.ts para chaves api_keys)
// ---------------------------------------------------------------------------

export interface TransportSecurityResult {
  signature: "verified" | "absent-accepted";
  /** "persistent" = nonce registado na BD; "memory-fallback" = degradação. */
  nonceStore: "persistent" | "memory-fallback";
}

/** Auditoria best-effort da transição C3-1 (chave com segredo, sem X-Signature). */
async function auditSignatureMissing(identity: ApiKeyIdentity): Promise<void> {
  if (!isSupabaseConfigured() || !identity.apiKeyId) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("audit_logs").insert({
      org_id: identity.orgId,
      actor_user_id: null,
      actor_type: "api_key",
      action: "auth.signature_missing",
      entity_type: "api_key",
      entity_id: identity.apiKeyId,
      diff: { actor_id: identity.apiKeyId },
    });
  } catch {
    // Auditoria nunca pode partir a autenticação (nem fingir sucesso).
  }
}

/**
 * Insert-first do nonce na tabela persistente.
 * - Sucesso → "persistent".
 * - Conflito de PK (23505) → REPLAY_DETECTED (401), como no caminho legado.
 * - Tabela inexistente (pré-0011) → degradação graciosa para o store em
 *   memória (mesma semântica por instância) → "memory-fallback".
 * - Qualquer outro erro → 500 fail-closed: sem registo do nonce, o pedido
 *   não avança.
 */
async function registerNonce(
  request: NextRequest,
  identity: ApiKeyIdentity,
  keyFingerprint: string,
  tsSeconds: number,
  nonce: string,
): Promise<"persistent" | "memory-fallback"> {
  if (isSupabaseConfigured()) {
    let insertError: { code?: string; message?: string } | null = null;
    let insertThrew = false;
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("api_request_nonces").insert({
        api_key_id: identity.apiKeyId,
        nonce,
        request_ts: new Date(tsSeconds * 1000).toISOString(),
        expires_at: new Date(
          (tsSeconds + NONCE_TTL_SECONDS) * 1000,
        ).toISOString(),
      });
      insertError = error;
    } catch {
      insertThrew = true;
    }
    if (!insertThrew && !insertError) return "persistent";
    if (
      !insertThrew &&
      insertError &&
      (insertError as { code?: string }).code === "23505"
    ) {
      throw new HubError("REPLAY_DETECTED", "Nonce já utilizado (replay).", 401);
    }
    if (insertThrew || isMissingTableError(insertError)) {
      console.warn(
        "[api-signing] api_request_nonces indisponível (migration 0011 por aplicar?) — anti-replay degradado para memória (por instância).",
      );
      checkReplayProtection(request.headers, keyFingerprint);
      return "memory-fallback";
    }
    throw new HubError(
      "INTERNAL",
      "Não foi possível registar o nonce anti-replay.",
      500,
    );
  }
  checkReplayProtection(request.headers, keyFingerprint);
  return "memory-fallback";
}

/**
 * Segurança de transporte completa para identidades da tabela `api_keys`:
 * timestamp (janela) → X-Key-Id coerente → assinatura HMAC → nonce.
 * `keyFingerprint` = sha256 da chave crua (para o fallback em memória).
 */
export async function enforceM2mTransportSecurity(
  request: NextRequest,
  identity: ApiKeyIdentity,
  keyFingerprint: string,
): Promise<TransportSecurityResult> {
  const apiKeyId = identity.apiKeyId;
  if (!apiKeyId) {
    throw new HubError(
      "INTERNAL",
      "enforceM2mTransportSecurity chamado com identidade sem apiKeyId.",
      500,
    );
  }

  // 1) Timestamp + nonce: presença e janela (partilhado com o legado).
  const { tsRaw, tsSeconds, nonce } = parseReplayHeaders(request.headers);

  // 2) X-Key-Id, quando presente, tem de identificar ESTA chave.
  const keyIdHeader = request.headers.get("x-key-id");
  if (keyIdHeader && keyIdHeader !== apiKeyId) {
    throw HubError.unauthorized(
      "Cabeçalho X-Key-Id não corresponde à chave apresentada.",
    );
  }

  // 3) Assinatura HMAC (Opção A: segredo dedicado, resolvido pela ref).
  const provided = request.headers.get("x-signature");
  const secret = identity.signingSecretRef
    ? resolveSigningSecret(identity.signingSecretRef)
    : null;
  let signature: TransportSecurityResult["signature"];
  if (provided) {
    if (!secret) throw genericSignatureError();
    const body = await request.clone().text();
    const canonical = buildCanonicalString({
      method: request.method,
      pathAndQuery: canonicalPathAndQuery(request.nextUrl),
      timestamp: tsRaw,
      nonce,
      body,
    });
    if (!verifyCanonicalSignature(secret, canonical, provided)) {
      throw genericSignatureError();
    }
    signature = "verified";
  } else if (signaturesRequired()) {
    throw genericSignatureError();
  } else {
    signature = "absent-accepted";
    // Transição C3-1 observável: a chave TEM segredo e devia assinar.
    if (secret) await auditSignatureMissing(identity);
  }

  // 4) Nonce: persistente insert-first (ou degradação honesta).
  const nonceStore = await registerNonce(
    request,
    identity,
    keyFingerprint,
    tsSeconds,
    nonce,
  );

  return { signature, nonceStore };
}

/**
 * Limpeza dos nonces expirados (operação periódica — spec §3.1).
 * A disponibilidade de pg_cron no projeto NÃO está verificada; esta função
 * existe para ser chamada por uma tarefa agendada externa ou manualmente.
 * Devolve o erro como string (null = sucesso) em vez de lançar: é uma
 * rotina de manutenção, não um caminho de pedido.
 */
export async function cleanupExpiredNonces(): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase não configurado." };
  }
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("api_request_nonces")
      .delete()
      .lt("expires_at", new Date().toISOString());
    return { error: error ? error.message : null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
