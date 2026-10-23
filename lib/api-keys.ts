/**
 * Athena Tools Hub — autenticação machine-to-machine (contrato Athena).
 *
 * - Chaves NUNCA são armazenadas em texto: apenas o hash SHA-256.
 * - `verifyApiKey(rawKey)` retorna { orgId, scopes, integrationId } | null.
 * - Proteção contra replay: o cliente deve enviar
 *     X-Request-Timestamp: <unix seconds>   (±5 min de tolerância)
 *     X-Nonce: <uuid único por requisição>
 *
 * FASE 2D (C5 + C3) — dois caminhos de verificação, transição aditiva:
 *   1. Tabela dedicada `api_keys` (migration 0011, PREPARADA — gate G2 é
 *      aplicá-la): lookup O(1) por hash indexado, com expiração e
 *      revogação decisivas. A identidade ganha `apiKeyId` e
 *      `signingSecretRef`, e a proteção de transporte (assinatura HMAC +
 *      nonce persistente) é aplicada em lib/api-signing.ts.
 *   2. Caminho legado: varredura de `integrations.config.apiKeyHash`
 *      (nonce em memória, por instância). Continua a ser o comportamento
 *      enquanto a 0011 não for aplicada — a ausência da tabela é detetada
 *      e cai-se aqui sem partir nada. Desligável com
 *      HUB_API_KEYS_LEGACY_FALLBACK=false (fim da transição, gate G5).
 *   Uma chave ENCONTRADA na tabela nova nunca cai para o legado: revogada
 *   ou expirada lá = recusada, ponto final.
 *
 * Emissão/revogação: endpoints de gestão em
 * app/api/v1/integrations/[integrationId]/api-keys (só sessão humana
 * owner/admin — lib/api-keys-admin.ts). A chave crua é exibida UMA vez e
 * nunca persiste em logs, banco ou git.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HubError } from "./errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "./auth";

export interface ApiKeyIdentity {
  orgId: string;
  scopes: string[];
  integrationId: string;
  /** FASE 2D — presente só quando a identidade veio da tabela `api_keys`. */
  apiKeyId?: string;
  /** Referência (nunca o valor) do segredo de assinatura no cofre. */
  signingSecretRef?: string | null;
  /** Hash SHA-256 da chave apresentada (nunca a chave crua). */
  keyHash?: string;
  /** Origem da identidade — diagnóstico e honestidade de estado. */
  source?: "api_keys" | "legacy";
}

const REPLAY_WINDOW_SECONDS = 300;
const NONCE_TTL_MS = 10 * 60_000;
/** Throttle da escrita de last_used_at na tabela api_keys (spec §4.3). */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * A tabela consultada ainda não existe nesta base? (mundo pré-0011).
 * PostgREST devolve PGRST205/"could not find the table"; o erro PG cru é
 * 42P01. Qualquer outro erro NÃO é isto — é tratado como indisponibilidade
 * real pelos chamadores, nunca como "tabela em falta".
 */
export function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = error.message ?? "";
  return (
    /could not find the table/i.test(msg) ||
    /relation .* does not exist/i.test(msg)
  );
}

/** Fallback legado ligado? (transição de UMA release — spec §4.4, gate G5). */
export function isLegacyFallbackEnabled(): boolean {
  return process.env.HUB_API_KEYS_LEGACY_FALLBACK !== "false";
}

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
 * FASE 2D (C3, Opção A ratificada) — segredo de assinatura DEDICADO,
 * distinto da chave Bearer: é com ele que o cliente assina cada pedido
 * (HMAC-SHA256, lib/api-signing.ts). Vive no cofre dos dois lados; a BD
 * guarda apenas a referência (`api_keys.signing_secret_ref`). Exibido uma
 * única vez, na emissão, junto da chave.
 */
export function generateSigningSecret(): string {
  return `hub_sign_${randomBytes(32).toString("hex")}`;
}

interface ApiKeyRow {
  id: string;
  org_id: string;
  integration_id: string | null;
  key_hash: string;
  scopes: string[] | null;
  signing_secret_ref: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

type ApiKeysLookup =
  | { status: "identity"; identity: ApiKeyIdentity }
  /** Linha existe mas está revogada/expirada (ou incoerente): DECISIVO — sem fallback. */
  | { status: "rejected" }
  /** Sem linha nesta tabela: pode ser uma chave legada. */
  | { status: "absent" }
  /** Tabela inexistente (pré-0011) ou leitura falhou: mundo de transição. */
  | { status: "unavailable" };

/** Auditoria best-effort de uma chave da tabela nova apresentada já morta. */
async function auditRejectedKey(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  row: ApiKeyRow,
  action: "auth.key_revoked" | "auth.key_expired",
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      org_id: row.org_id,
      actor_user_id: null,
      actor_type: "api_key",
      action,
      entity_type: "api_key",
      entity_id: row.id,
      diff: { actor_id: row.id },
    });
  } catch {
    // Auditoria nunca pode partir a autenticação (nem fingir sucesso).
  }
}

/**
 * Caminho novo (C5): lookup O(1) por `key_hash` (UNIQUE) na tabela
 * `api_keys`. Nunca lança: os estados possíveis voltam em ApiKeysLookup
 * para o chamador decidir (rejeitado é decisivo; ausente/indisponível
 * segue para o fallback legado durante a transição).
 */
async function verifyViaApiKeysTable(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  keyHash: string,
): Promise<ApiKeysLookup> {
  let row: ApiKeyRow | null;
  try {
    const { data, error } = await supabase
      .from("api_keys")
      .select(
        "id, org_id, integration_id, key_hash, scopes, signing_secret_ref, expires_at, last_used_at, revoked_at",
      )
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (error) return { status: "unavailable" };
    row = (data as ApiKeyRow | null) ?? null;
  } catch {
    return { status: "unavailable" };
  }
  if (!row) return { status: "absent" };

  // Defesa em profundidade (spec §4.3): o índice já garantiu a igualdade,
  // mas a comparação em tempo constante confirma que a linha devolvida é
  // MESMO a desta chave — uma linha incoerente recusa, sem fallback.
  let hashMatches = false;
  try {
    const stored = Buffer.from(row.key_hash, "hex");
    const presented = Buffer.from(keyHash, "hex");
    hashMatches =
      stored.length === presented.length &&
      timingSafeEqual(stored, presented);
  } catch {
    hashMatches = false;
  }
  if (!hashMatches) return { status: "rejected" };

  if (row.revoked_at) {
    await auditRejectedKey(supabase, row, "auth.key_revoked");
    return { status: "rejected" };
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    await auditRejectedKey(supabase, row, "auth.key_expired");
    return { status: "rejected" };
  }

  // last_used_at com throttle de 60 s (spec §4.3): no máximo 1 escrita/min
  // por chave. Best-effort — uma falha aqui não invalida a autenticação.
  const lastUsedMs = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (Date.now() - lastUsedMs > LAST_USED_THROTTLE_MS) {
    try {
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch {
      // Bookkeeping apenas.
    }
  }

  return {
    status: "identity",
    identity: {
      orgId: row.org_id,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      // Chave sem integração dona: o ator m2m é a própria chave.
      integrationId: row.integration_id ?? row.id,
      apiKeyId: row.id,
      signingSecretRef: row.signing_secret_ref,
      keyHash,
      source: "api_keys",
    },
  };
}

/**
 * Caminho legado: varredura das integrações ligadas com comparação em
 * tempo constante (comportamento intacto desde a Fase 1).
 * FASE 1 — drift corrigido: a tabela integrations NÃO tem coluna `status`;
 * a coluna real é `state` (enum tool_state). 'connected' = integração ativa.
 * Ver supabase/migrations/0001_core.sql.
 */
async function verifyViaLegacyIntegrations(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  keyHash: string,
): Promise<ApiKeyIdentity | null> {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, org_id, config")
    .eq("state", "connected");
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
        keyHash,
        source: "legacy",
      };
    }
  }
  return null;
}

/**
 * Valida a chave crua. Ordem (transição C5, spec §4.4):
 *   1. Tabela `api_keys` — identidade ou rejeição DECISIVA (revogada/
 *      expirada nunca ressuscita pelo caminho legado).
 *   2. Sem linha / tabela inexistente → fallback legado (flag
 *      HUB_API_KEYS_LEGACY_FALLBACK, ligada por omissão nesta release).
 * Retorna a identidade vinculada ou null (401 genérico no chamador).
 */
export async function verifyApiKey(
  rawKey: string,
): Promise<ApiKeyIdentity | null> {
  if (!rawKey || !isSupabaseConfigured()) return null;
  const keyHash = sha256Hex(rawKey);
  const supabase = getSupabaseAdmin();

  const viaTable = await verifyViaApiKeysTable(supabase, keyHash);
  if (viaTable.status === "identity") return viaTable.identity;
  if (viaTable.status === "rejected") return null;

  if (!isLegacyFallbackEnabled()) return null;
  return verifyViaLegacyIntegrations(supabase, keyHash);
}

export interface ReplayCheckResult {
  ok: true;
}

export interface ReplayHeaders {
  /** Valor cru do cabeçalho (é ESTA string que entra na assinatura HMAC). */
  tsRaw: string;
  tsSeconds: number;
  nonce: string;
}

/**
 * Valida presença e janela (±300 s) de X-Request-Timestamp + X-Nonce.
 * Partilhado pelo caminho legado (memória) e pelo caminho novo
 * (lib/api-signing.ts: assinatura + nonce persistente) — a ordem de
 * validação da spec §3.2 começa aqui. Lança HubError 401 em caso de falha.
 */
export function parseReplayHeaders(headers: Headers): ReplayHeaders {
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
  return { tsRaw, tsSeconds: ts, nonce };
}

/**
 * Valida timestamp + nonce anti-replay (store em memória, por instância).
 * Lança HubError em caso de falha.
 * `keyFingerprint` = sha256 da chave (nunca a chave crua).
 * Para identidades da tabela `api_keys`, quem chama é
 * lib/api-signing.ts (nonce persistente insert-first, com ESTA função
 * como degradação graciosa enquanto a 0011 não for aplicada).
 */
export function checkReplayProtection(
  headers: Headers,
  keyFingerprint: string,
): ReplayCheckResult {
  const { nonce } = parseReplayHeaders(headers);

  const now = Date.now();
  const nonces = pruneNonces(keyFingerprint, now);
  if (nonces.has(nonce)) {
    throw new HubError("REPLAY_DETECTED", "Nonce já utilizado (replay).", 401);
  }
  nonces.set(nonce, now + NONCE_TTL_MS);
  return { ok: true };
}
