/**
 * Athena Tools Hub — FASE 2D (C5): gestão de chaves de API da tabela
 * `api_keys` (emissão, revogação, rotação, listagem de metadados).
 *
 * Quem pode chamar isto: SÓ as rotas de gestão, depois de
 * `requireSessionUser` + `resolveOrgScope(..., ["owner", "admin"])` —
 * sessão humana owner/admin da org dona da integração. Chaves de API
 * nunca gerem chaves (lib/api-auth.ts).
 *
 * Regras (spec docs/FASE2C_C3_C5_SPEC.md §4.5 + decisões ratificadas):
 *   - Emissão devolve a chave crua e o segredo de assinatura UMA vez;
 *     a BD guarda apenas hash + referência do segredo.
 *   - Expiração por omissão: 90 dias (decisão da Cristiane).
 *   - Revogação é imediata (o lookup filtra revoked_at) e irreversível;
 *     rotação = emitir nova + revogar a antiga, ligadas por
 *     replaced_by_id na chave antiga.
 *   - Listagem expõe METADADOS apenas — `key_hash` nunca é selecionado.
 *   - Tudo fica em audit_logs (api_key.issued / api_key.revoked), sem
 *     valores secretos.
 *
 * Estado honesto pré-0011: sem a tabela, as operações devolvem 501
 * NOT_IMPLEMENTED com a explicação (migration preparada, gate G2 por
 * aplicar) — nada é simulado nem cai silenciosamente para o caminho
 * legado, porque emitir "para o legado" seria emitir sem expiração nem
 * revogação, o contrário do objetivo da C5.
 */

import { randomUUID } from "node:crypto";
import { HubError } from "./errors";
import { getSupabaseAdmin, isSupabaseConfigured } from "./auth";
import {
  generateApiKey,
  generateSigningSecret,
  isMissingTableError,
} from "./api-keys";

/** Expiração por omissão das chaves m2m — decisão ratificada (90 dias). */
export const API_KEY_DEFAULT_TTL_DAYS = 90;
/** Janela do relatório "a expirar em breve" (spec §4.5). */
export const API_KEY_EXPIRING_SOON_DAYS = 14;

const METADATA_COLUMNS =
  "id, label, scopes, signing_secret_ref, created_at, expires_at, last_used_at, revoked_at, replaced_by_id";

export interface IntegrationRef {
  id: string;
  orgId: string;
  name: string;
  state: string;
}

export interface ApiKeyMetadata {
  id: string;
  label: string;
  scopes: string[];
  signingSecretRef: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  replacedById: string | null;
  /** Ativa e a expirar dentro da janela de aviso (14 dias). */
  expiringSoon: boolean;
}

export interface IssuedApiKey extends ApiKeyMetadata {
  /** Valor cru — exibido UMA vez nesta resposta, nunca persistido. */
  rawKey: string;
  /** Segredo de assinatura (Opção A) — exibido UMA vez; null se não pedido. */
  signingSecret: string | null;
}

interface ApiKeyMetadataRow {
  id: string;
  label: string;
  scopes: string[] | null;
  signing_secret_ref: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  replaced_by_id: string | null;
}

function toMetadata(row: ApiKeyMetadataRow): ApiKeyMetadata {
  const expiresMs = row.expires_at ? Date.parse(row.expires_at) : null;
  const now = Date.now();
  return {
    id: row.id,
    label: row.label,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    signingSecretRef: row.signing_secret_ref,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
    expiringSoon:
      !row.revoked_at &&
      expiresMs !== null &&
      expiresMs > now &&
      expiresMs - now <= API_KEY_EXPIRING_SOON_DAYS * 86_400_000,
  };
}

/** Erro de BD → 501 honesto se for a tabela em falta; 500 nos restantes. */
function tableErrorOrInternal(
  error: { code?: string; message?: string },
  operation: string,
): HubError {
  if (isMissingTableError(error)) {
    return HubError.notImplemented(
      `A tabela api_keys ainda não existe nesta base: a migration 0011 está preparada mas não foi aplicada (gate G2). A gestão de chaves por endpoint fica disponível depois da aplicação — ${operation} não foi executado.`,
    );
  }
  return new HubError(
    "INTERNAL",
    `Falha ao ${operation} a chave de API.`,
    500,
  );
}

async function writeAudit(input: {
  orgId: string;
  actorUserId: string;
  action: "api_key.issued" | "api_key.revoked";
  entityId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("audit_logs").insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId,
    actor_type: "user",
    action: input.action,
    entity_type: "api_key",
    entity_id: input.entityId,
    diff: { ...(input.detail ?? {}), actor_id: input.actorUserId },
  });
  if (error) {
    throw new HubError("INTERNAL", "Falha ao registrar auditoria.", 500);
  }
}

/** Carrega a integração dona das chaves (null = não existe). */
export async function loadIntegration(
  integrationId: string,
): Promise<IntegrationRef | null> {
  if (!isSupabaseConfigured()) throw HubError.notConfigured();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("integrations")
    .select("id, org_id, name, state")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) {
    throw new HubError("INTERNAL", "Não foi possível carregar a integração.", 500);
  }
  if (!data) return null;
  const row = data as { id: string; org_id: string; name: string; state: string };
  return { id: row.id, orgId: row.org_id, name: row.name, state: row.state };
}

export interface IssueApiKeyInput {
  integration: IntegrationRef;
  label: string;
  scopes: string[];
  /** Dias até expirar; omisso = 90 (decisão ratificada). */
  expiresInDays?: number;
  /** Emitir também o segredo de assinatura dedicado (Opção A). Default: sim. */
  withSigningSecret?: boolean;
  /** Rotação: id da chave que esta substitui (mesma integração/org). */
  replacesKeyId?: string;
  actorUserId: string;
}

/**
 * Emite uma chave nova. O id é gerado aqui (não pela BD) porque, na
 * Opção A, a referência do segredo no cofre É o id da chave — o operador
 * guarda no cofre { "<id>": "<segredo>" } e o cliente apresenta esse id
 * em X-Key-Id.
 */
export async function issueApiKey(
  input: IssueApiKeyInput,
): Promise<IssuedApiKey> {
  const supabase = getSupabaseAdmin();
  const id = randomUUID();
  const { rawKey, keyHash } = generateApiKey();
  const withSigning = input.withSigningSecret !== false;
  const signingSecret = withSigning ? generateSigningSecret() : null;
  const signingSecretRef = withSigning ? id : null;
  const expiresAt = new Date(
    Date.now() +
      (input.expiresInDays ?? API_KEY_DEFAULT_TTL_DAYS) * 86_400_000,
  ).toISOString();

  // Rotação: a chave substituída tem de existir e ser DESTA integração/org
  // — validar ANTES de emitir, para nunca deixar uma chave órfã emitida.
  if (input.replacesKeyId) {
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, integration_id, org_id")
      .eq("id", input.replacesKeyId)
      .maybeSingle();
    if (error) throw tableErrorOrInternal(error, "emitir");
    const old = data as {
      id: string;
      integration_id: string | null;
      org_id: string;
    } | null;
    if (!old) {
      throw HubError.validation(
        "replacesKeyId não corresponde a uma chave existente.",
      );
    }
    if (
      old.integration_id !== input.integration.id ||
      old.org_id !== input.integration.orgId
    ) {
      throw HubError.validation(
        "replacesKeyId pertence a outra integração/organização.",
      );
    }
  }

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      id,
      org_id: input.integration.orgId,
      integration_id: input.integration.id,
      label: input.label,
      key_hash: keyHash,
      scopes: input.scopes,
      signing_secret_ref: signingSecretRef,
      created_by: input.actorUserId,
      expires_at: expiresAt,
    })
    .select(METADATA_COLUMNS)
    .maybeSingle();
  if (error) throw tableErrorOrInternal(error, "emitir");
  const row = data as ApiKeyMetadataRow | null;
  if (!row) {
    throw new HubError("INTERNAL", "Falha ao emitir a chave de API.", 500);
  }

  // Linhagem de rotação: a chave ANTIGA passa a apontar para a nova.
  // A antiga NÃO é revogada aqui — a sobreposição é controlada pelo
  // operador (revogar a antiga ou deixá-la expirar), como na spec §4.5.
  if (input.replacesKeyId) {
    const { error: linkError } = await supabase
      .from("api_keys")
      .update({ replaced_by_id: id })
      .eq("id", input.replacesKeyId);
    if (linkError) {
      throw new HubError(
        "INTERNAL",
        "Chave emitida, mas a linhagem de rotação não foi registada.",
        500,
      );
    }
  }

  await writeAudit({
    orgId: input.integration.orgId,
    actorUserId: input.actorUserId,
    action: "api_key.issued",
    entityId: id,
    detail: {
      integration_id: input.integration.id,
      label: input.label,
      scopes: input.scopes,
      expires_at: expiresAt,
      signing: withSigning,
      replaces: input.replacesKeyId ?? null,
    },
  });

  return { ...toMetadata(row), rawKey, signingSecret };
}

/**
 * Revoga uma chave (revoked_at = agora; efeito imediato no lookup).
 * Idempotente: revogar uma chave já revogada devolve os metadados sem
 * erro e sem duplicar auditoria. Chave de outra integração/org = 404
 * (não se confirma a existência de credenciais alheias).
 */
export async function revokeApiKey(input: {
  integration: IntegrationRef;
  keyId: string;
  actorUserId: string;
}): Promise<ApiKeyMetadata> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select(`${METADATA_COLUMNS}, integration_id, org_id`)
    .eq("id", input.keyId)
    .maybeSingle();
  if (error) throw tableErrorOrInternal(error, "revogar");
  const row = data as
    | (ApiKeyMetadataRow & { integration_id: string | null; org_id: string })
    | null;
  if (
    !row ||
    row.integration_id !== input.integration.id ||
    row.org_id !== input.integration.orgId
  ) {
    throw HubError.notFound("Chave de API");
  }
  if (row.revoked_at) return toMetadata(row);

  const revokedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("api_keys")
    .update({ revoked_at: revokedAt })
    .eq("id", input.keyId);
  if (updateError) throw tableErrorOrInternal(updateError, "revogar");

  await writeAudit({
    orgId: input.integration.orgId,
    actorUserId: input.actorUserId,
    action: "api_key.revoked",
    entityId: input.keyId,
    detail: { integration_id: input.integration.id },
  });

  return toMetadata({ ...row, revoked_at: revokedAt });
}

/** Lista os METADADOS das chaves da integração (nunca o hash). */
export async function listApiKeys(
  integration: IntegrationRef,
): Promise<ApiKeyMetadata[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select(METADATA_COLUMNS)
    .eq("integration_id", integration.id)
    .eq("org_id", integration.orgId)
    .order("created_at", { ascending: false });
  if (error) throw tableErrorOrInternal(error, "listar");
  return ((data as ApiKeyMetadataRow[] | null) ?? []).map(toMetadata);
}
