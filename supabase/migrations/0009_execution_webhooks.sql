-- ===========================================================================
-- ATHENA TOOLS HUB — 0009_execution_webhooks.sql
-- Job attempts, integration endpoints, webhooks and delivery log.
--
-- WHAT THIS ADDS
--   * public.job_attempts — individual attempts of an execution_jobs row.
--     UNIQUE per (job_id, attempt_no); append-only for app users
--     (same honesty model as execution_events in 0002).
--   * public.integration_endpoints — concrete endpoints exposed by an
--     integration (HTTP route, MCP tool, CLI command...). UNIQUE per
--     (integration_id, name). Reuses the integration_type enum from 0001.
--   * public.webhooks — inbound/outbound webhook registrations.
--     Inbound webhooks are addressed by an unguessable path_token
--     (globally unique); the signing secret is NEVER stored here —
--     secret_ref points at the vault entry.
--   * public.webhook_deliveries — per-delivery log (status, attempts,
--     response code). Append-only for app users; the server (service_role)
--     updates delivery status as callbacks complete.
--
-- Re-runnable: guarded enum creation, IF NOT EXISTS / OR REPLACE / DROP IF
-- EXISTS before every CREATE.
-- RLS: see 0010_rls_phase2.sql (never ship a table without RLS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum types (guarded: re-runnable)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.webhook_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.webhook_delivery_status AS ENUM (
    'pending',
    'delivering',
    'delivered',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- job_attempts (append-only attempts per execution job)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES public.execution_jobs (id) ON DELETE CASCADE,
  attempt_no  integer NOT NULL,                  -- 1-based; UNIQUE per job
  state       public.job_state NOT NULL DEFAULT 'CREATED',
  error       jsonb,                             -- structured error { code, message, details }
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_attempts_job_no_unique UNIQUE (job_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS job_attempts_org_idx ON public.job_attempts (org_id);
CREATE INDEX IF NOT EXISTS job_attempts_job_idx ON public.job_attempts (job_id);

-- ---------------------------------------------------------------------------
-- integration_endpoints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_endpoints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations (id) ON DELETE CASCADE,
  name           text NOT NULL,                  -- e.g. 'runs.create'
  kind           public.integration_type NOT NULL,
  url            text,                           -- HTTP endpoint URL (kind='api'/'webhook')
  method         text,                           -- e.g. 'POST' (kind='api')
  config         jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret config only
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_endpoints_integration_name_unique UNIQUE (integration_id, name)
);
CREATE INDEX IF NOT EXISTS integration_endpoints_org_idx         ON public.integration_endpoints (org_id);
CREATE INDEX IF NOT EXISTS integration_endpoints_integration_idx ON public.integration_endpoints (integration_id);

-- ---------------------------------------------------------------------------
-- webhooks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhooks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  integration_id uuid REFERENCES public.integrations (id) ON DELETE SET NULL,
  name           text NOT NULL,
  direction      public.webhook_direction NOT NULL DEFAULT 'outbound',
  target_url     text,                           -- outbound delivery target
  path_token     text,                           -- inbound address token (unguessable, globally unique)
  secret_ref     text,                           -- vault reference for the signing secret — NEVER the secret itself
  events         text[] NOT NULL DEFAULT '{}',   -- subscribed event names; empty = all
  is_active      boolean NOT NULL DEFAULT true,
  config         jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret config only
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_org_name_unique UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS webhooks_org_idx         ON public.webhooks (org_id);
CREATE INDEX IF NOT EXISTS webhooks_integration_idx ON public.webhooks (integration_id);
-- Inbound tokens must be unique when present (NULLs never collide).
CREATE UNIQUE INDEX IF NOT EXISTS webhooks_path_token_unique
  ON public.webhooks (path_token) WHERE path_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- webhook_deliveries (append-only delivery log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  webhook_id    uuid NOT NULL REFERENCES public.webhooks (id) ON DELETE CASCADE,
  event_name    text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        public.webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  response_code integer,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_org_idx     ON public.webhook_deliveries (org_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx ON public.webhook_deliveries (webhook_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx  ON public.webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS webhook_deliveries_created_idx ON public.webhook_deliveries (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (re-runnable via DROP + CREATE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_attempts', 'integration_endpoints', 'webhooks', 'webhook_deliveries'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;
