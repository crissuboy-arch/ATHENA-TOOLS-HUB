-- ===========================================================================
-- ATHENA TOOLS HUB — 0011_api_keys.sql
-- Dedicated API key storage + persistent anti-replay nonces (FASE 2D: C5+C3).
--
-- STATUS — READ BEFORE RUNNING:
--   * This file was PREPARED in Fase 2D (gate G0) from the approved spec
--     docs/FASE2C_C3_C5_SPEC.md (Anexo A). It has NOT been applied to any
--     database — not production, not staging, not local.
--   * Applying it is gate G2: a separate, explicit decision by the owner,
--     executed manually in the Supabase SQL editor, in numeric order,
--     after 0001–0010. Code in this repo works WITHOUT this migration
--     (legacy auth path stays authoritative until the table exists).
--   * Rollback: see docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md. Dropping these
--     tables is a manual, owner-approved step — never automatic.
--
-- WHAT THIS ADDS
--   * public.api_keys — one row per issued machine-to-machine key.
--     Only the SHA-256 hash of the raw key is stored (NEVER the raw key);
--     lookup is O(1) on the UNIQUE key_hash index, replacing the legacy
--     scan over integrations.config (closes B6). Expiry (expires_at,
--     default +90 days at issuance time), immediate revocation
--     (revoked_at) and rotation lineage (replaced_by_id) are first-class
--     columns instead of manual SQL surgery.
--   * public.api_request_nonces — persistent anti-replay store.
--     Written insert-first BEFORE the request is processed: the primary
--     key (api_key_id, nonce) makes replay rejection atomic across every
--     app instance, replacing the per-process in-memory Map (closes B2's
--     persistence half; the HMAC signature in code closes the other half).
--
-- SECURITY MODEL (closes B5)
--   * RLS is ENABLED on both tables with ZERO policies for anon /
--     authenticated — deliberate fail-closed, the strongest form of the
--     repo pattern: no org member (not even an owner) can read key hashes
--     or nonces through PostgREST. Access is service_role only, from
--     server code (verifyApiKey, key management endpoints), which is the
--     model of the whole /api/v1 surface.
--   * signing_secret_ref is a vault REFERENCE (Opção A of the spec): the
--     dedicated HMAC signing secret itself lives in the vault / server
--     environment, never in this database — only its reference does.
--
-- Re-runnable: IF NOT EXISTS / ON CONFLICT DO NOTHING throughout, in the
-- style of 0001–0010.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- api_keys — dedicated credential rows (C5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  integration_id     uuid REFERENCES public.integrations (id) ON DELETE SET NULL,
  label              text NOT NULL,
  key_hash           text NOT NULL UNIQUE,
  scopes             text[] NOT NULL DEFAULT '{}',
  signing_secret_ref text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  replaced_by_id     uuid REFERENCES public.api_keys (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (org_id);
-- The hot lookup is the UNIQUE constraint on key_hash above; this partial
-- index serves the "keys expiring soon" operator report.
CREATE INDEX IF NOT EXISTS api_keys_expires_idx
  ON public.api_keys (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- api_request_nonces — persistent anti-replay (C3b)
-- One row per (key, nonce) actually seen; expires_at = request_ts + 600 s
-- (2x the ±300 s acceptance window: after that, the timestamp alone would
-- reject a replay, so the row is safe to delete — see the rollback/cleanup
-- notes in docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_request_nonces (
  api_key_id uuid NOT NULL REFERENCES public.api_keys (id) ON DELETE CASCADE,
  nonce      text NOT NULL,
  request_ts timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, nonce)
);
CREATE INDEX IF NOT EXISTS api_request_nonces_expires_idx
  ON public.api_request_nonces (expires_at);

-- ---------------------------------------------------------------------------
-- RLS — enabled, ZERO policies on purpose (fail-closed; see header).
-- No CREATE POLICY statements follow, and that absence is the control:
-- PostgREST roles get nothing; service_role bypasses RLS by design and
-- the server remains responsible for org scoping, as everywhere else here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_nonces ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Backfill — legacy keys living in integrations.config survive the move
-- with their hash unchanged (the raw key value never changes hands again).
-- Rows without an apiKeyHash are skipped; safe to re-run.
-- ---------------------------------------------------------------------------
INSERT INTO public.api_keys (org_id, integration_id, label, key_hash, scopes, created_by, created_at)
SELECT org_id, id, name, config ->> 'apiKeyHash',
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(config -> 'scopes')), '{}'),
       created_by, created_at
FROM public.integrations
WHERE config ? 'apiKeyHash'
ON CONFLICT (key_hash) DO NOTHING;
