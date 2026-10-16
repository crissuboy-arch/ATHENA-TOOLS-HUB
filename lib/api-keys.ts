/**
 * Athena Tools Hub — autenticação machine-to-machine (contrato Athena).
 *
 * - Chaves NUNCA são armazenadas em texto: apenas o hash SHA-256 fica em
 *   `integrations.config.apiKeyHash` (JSONB), junto de `scopes` (array).
 * - `verifyApiKey(rawKey)` retorna { orgId, scopes, integrationId } | null.
 * - Proteção contra replay: o cliente deve enviar
 *     X-Request-Timestamp: <unix seconds>   (±5 min de tolerância)
 *     X-Nonce: <uuid único por requisição>
 *   Nonces são rastreados em memória com TTL (10 min). Para deploy
 *   multi-instância, migrar para Redis (mesma semântica: SETNX com TTL).
 *
 * Emissão de chaves: use `generateApiKey()` e grave o hash via integração
 * (endpoint de emissão fica fora do escopo do MVP — documentado em
 * docs/ATHENA_INTEGRATION.md). A chave crua é exibida UMA vez e nunca
 * persiste em logs, banco ou git.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HubError } from "./errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "./auth";

export interface ApiKeyIdentity {
  orgId: string;
  scopes: string[];
  integrationId: string;
}

const REPLAY_WINDOW_SECONDS = 300;
const NONCE_TTL_MS = 10 * 60_000;

/** nonce → expiresAt (epoch ms), agrupado por hash da chave. */
const seenNonces = new Map<string, Map<string, number>>();

function pruneNonces(keyHash: string, now: number): Map<string, number> {
  let nonces = seenNonces.get(keyHash);
  if (!nonces) {
    nonces = new Map();
    seenNonces.set(keyHash, nonces);
    return nonces;
  }
  for (const [nonce, expiresAt] of nonces) {
    if (expiresAt <= now) nonces.delete(nonce);
  }
  return nonces;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Gera um par { rawKey, keyHash }.
 * rawKey: exibida uma única vez ao dono da integração. keyHash: o que se grava.
 */
export function generateApiKey(): { rawKey: string; keyHash: string } {
  const rawKey = `hub_live_${randomBytes(32).toString("hex")}`;
  return { rawKey, keyHash: sha256Hex(rawKey) };
}

/**
 * Valida a chave crua contra `integrations` ativas.
 * Retorna a identidade vinculada ou null (chave desconhecida/inativa).
 */
export async function verifyApiKey(
  rawKey: string,
): Promise<ApiKeyIdentity | null> {
  if (!rawKey || !isSupabaseConfigured()) return null;
  const keyHash = sha256Hex(rawKey);
  const supabase = getSupabaseAdmin();

  // MVP: varredura das integrações ativas com comparação em tempo constante.
  // (Tabela dedicada com índice no hash é o upgrade documentado.)
  const { data, error } = await supabase
    .from("integrations")
    .select("id, org_id, config")
    .eq("status", "active");
  if (error || !data) return null;

  const keyHashBuf = Buffer.from(keyHash, "hex");
  for (const row of data as Array<{
    id: string;
    org_id: string;
    config: { apiKeyHash?: string; scopes?: string[] } | null;
  }>) {
    const stored = row.config?.apiKeyHash;
    if (typeof stored !== "string" || stored.length !== keyHash.length) continue;
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(stored, "hex"), keyHashBuf);
    } catch {
      match = false;
    }
    if (match) {
      return {
        orgId: row.org_id,
        scopes: Array.isArray(row.config?.scopes) ? row.config.scopes : [],
        integrationId: row.id,
      };
    }
  }
  return null;
}

export interface ReplayCheckResult {
  ok: true;
}

/**
 * Valida timestamp + nonce anti-replay. Lança HubError em caso de falha.
 * `keyFingerprint` = sha256 da chave (nunca a chave crua).
 */
export function checkReplayProtection(
  headers: Headers,
  keyFingerprint: string,
): ReplayCheckResult {
  const tsRaw = headers.get("x-request-timestamp");
  const nonce = headers.get("x-nonce");

  if (!tsRaw || !nonce) {
    throw new HubError(
      "UNAUTHORIZED",
      "Cabeçalhos X-Request-Timestamp e X-Nonce são obrigatórios para chaves de API.",
      401,
    );
  }

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) {
    throw new HubError("UNAUTHORIZED", "X-Request-Timestamp inválido.", 401);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > REPLAY_WINDOW_SECONDS) {
    throw new HubError(
      "UNAUTHORIZED",
      "X-Request-Timestamp fora da janela permitida (±5 min).",
      401,
    );
  }

  const now = Date.now();
  const nonces = pruneNonces(keyFingerprint, now);
  if (nonces.has(nonce)) {
    throw new HubError("REPLAY_DETECTED", "Nonce já utilizado (replay).", 401);
  }
  nonces.set(nonce, now + NONCE_TTL_MS);
  return { ok: true };
}
