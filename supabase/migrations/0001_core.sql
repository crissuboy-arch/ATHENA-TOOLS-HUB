-- ATHENA TOOLS HUB — 0001_core.sql
-- Core schema: org-scoped tables for the tool catalog, job lifecycle,
-- approvals, assets, usage/cost and audit trail.
--
-- Conventions: gen_random_uuid() PKs, timestamptz, JSONB for params/result/
-- error/config/diff. FKs use ON DELETE CASCADE for org-owned data and
-- ON DELETE SET NULL / RESTRICT where history must survive.
-- No RLS here (see 0002_rls.sql). No seed data here (see 0003_seed.sql).
-- This file is re-runnable: every CREATE uses IF NOT EXISTS / OR REPLACE
-- and enum creation is guarded by a DO block.

-- ---------------------------------------------------------------------------
-- Extensions & helper
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum types (guarded: re-runnable)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_member_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Honest tool lifecycle. A tool is NEVER marked operational-tested without
  -- a real passing integration test. See README "Tool states (honest, always)".
  CREATE TYPE public.tool_state AS ENUM (
    'cataloged',
    'needs-config',
    'in-development',
    'connected',
    'operational-tested',
    'error',
    'unavailable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.integration_type AS ENUM ('mcp', 'cli', 'api', 'webhook', 'sdk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.job_state AS ENUM (
    'CREATED',
    'VALIDATING',
    'PENDING_APPROVAL',
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'expired',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.actor_type AS ENUM ('user', 'api_key', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_by  uuid,                       -- auth user id (no FK to auth.users on purpose)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON public.organizations (slug);

-- ---------------------------------------------------------------------------
-- organization_members (who belongs to an org, and with which role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,              -- Supabase auth.users.id (intentionally no FK)
  role        public.org_member_role NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_org_user_unique UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_org_idx  ON public.organization_members (org_id);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- tools (catalog entries — honest states only, never faked)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tools (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name              text NOT NULL,
  description       text,
  category          text,                 -- e.g. 'design', 'video', 'automation'
  state             public.tool_state NOT NULL DEFAULT 'cataloged',
  license           text,                 -- SPDX or name; NULL = not yet verified
  license_verified  boolean NOT NULL DEFAULT false,
  repo_url          text,
  website_url       text,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tools_org_slug_unique UNIQUE (org_id, slug)
);
CREATE INDEX IF NOT EXISTS tools_org_idx   ON public.tools (org_id);
CREATE INDEX IF NOT EXISTS tools_state_idx ON public.tools (state);

-- ---------------------------------------------------------------------------
-- tool_capabilities (what a tool can do — contract inputs/outputs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_capabilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tool_id       uuid NOT NULL REFERENCES public.tools (id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  input_schema  jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_capabilities_tool_name_unique UNIQUE (tool_id, name)
);
CREATE INDEX IF NOT EXISTS tool_capabilities_org_idx  ON public.tool_capabilities (org_id);
CREATE INDEX IF NOT EXISTS tool_capabilities_tool_idx ON public.tool_capabilities (tool_id);

-- ---------------------------------------------------------------------------
-- integrations (connections to external services: MCP, CLI, API, webhook)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name              text NOT NULL,
  provider          text NOT NULL,        -- e.g. 'apify', 'playwright', 'google-workspace'
  type              public.integration_type NOT NULL,
  state             public.tool_state NOT NULL DEFAULT 'cataloged',
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non-secret config only; secrets live in the vault
  last_test_at      timestamptz,
  last_test_result  jsonb,                -- { ok: bool, latency_ms, checked_at, error? }
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integrations_org_name_unique UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS integrations_org_idx      ON public.integrations (org_id);
CREATE INDEX IF NOT EXISTS integrations_provider_idx ON public.integrations (provider);

-- ---------------------------------------------------------------------------
-- execution_jobs (the job lifecycle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.execution_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tool_id          uuid REFERENCES public.tools (id) ON DELETE SET NULL,
  integration_id   uuid REFERENCES public.integrations (id) ON DELETE SET NULL,
  idempotency_key  text NOT NULL,         -- unique per org: safe retries, no double execution
  state            public.job_state NOT NULL DEFAULT 'CREATED',
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result           jsonb,                  -- final result payload
  error            jsonb,                   -- structured error { code, message, details }
  progress         numeric(5, 2) NOT NULL DEFAULT 0,  -- 0..100
  started_at       timestamptz,
  finished_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_jobs_org_key_unique UNIQUE (org_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS execution_jobs_org_idx   ON public.execution_jobs (org_id);
CREATE INDEX IF NOT EXISTS execution_jobs_state_idx  ON public.execution_jobs (state);
CREATE INDEX IF NOT EXISTS execution_jobs_tool_idx   ON public.execution_jobs (tool_id);
CREATE INDEX IF NOT EXISTS execution_jobs_created_idx ON public.execution_jobs (created_at DESC);

-- ---------------------------------------------------------------------------
-- execution_events (append-only timeline per job)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.execution_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES public.execution_jobs (id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  type        text NOT NULL,              -- e.g. 'state_changed', 'log', 'progress'
  message     text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS execution_events_job_idx     ON public.execution_events (job_id);
CREATE INDEX IF NOT EXISTS execution_events_org_idx     ON public.execution_events (org_id);
CREATE INDEX IF NOT EXISTS execution_events_created_idx ON public.execution_events (created_at DESC);

-- ---------------------------------------------------------------------------
-- approval_requests (human approval gate before execution/spend)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  job_id                 uuid REFERENCES public.execution_jobs (id) ON DELETE CASCADE,
  title                  text NOT NULL,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by           uuid,
  status                 public.approval_status NOT NULL DEFAULT 'pending',
  decided_by             uuid,             -- approver identity
  decision_justification text,             -- why it was approved/rejected
  decided_at             timestamptz,
  expires_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_requests_org_idx    ON public.approval_requests (org_id);
CREATE INDEX IF NOT EXISTS approval_requests_job_idx    ON public.approval_requests (job_id);
CREATE INDEX IF NOT EXISTS approval_requests_status_idx ON public.approval_requests (status);

-- ---------------------------------------------------------------------------
-- generated_assets (files/artifacts produced by jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  job_id      uuid REFERENCES public.execution_jobs (id) ON DELETE SET NULL,
  kind        text NOT NULL,              -- e.g. 'image', 'video', 'document', 'audio'
  name        text NOT NULL,
  file_path   text,                       -- storage path or external URL reference
  mime_type   text,
  size_bytes  bigint,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generated_assets_org_idx  ON public.generated_assets (org_id);
CREATE INDEX IF NOT EXISTS generated_assets_job_idx  ON public.generated_assets (job_id);
CREATE INDEX IF NOT EXISTS generated_assets_kind_idx ON public.generated_assets (kind);

-- ---------------------------------------------------------------------------
-- usage_records (consumption + cost tracking per job/tool)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  job_id      uuid REFERENCES public.execution_jobs (id) ON DELETE SET NULL,
  tool_id     uuid REFERENCES public.tools (id) ON DELETE SET NULL,
  kind        text NOT NULL,              -- e.g. 'api_calls', 'seconds', 'tokens', 'credits'
  quantity    numeric NOT NULL DEFAULT 0,
  unit        text,                       -- unit label for the quantity
  cost_cents  integer NOT NULL DEFAULT 0, -- cost in minor currency units
  currency    text NOT NULL DEFAULT 'USD',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_records_org_idx      ON public.usage_records (org_id);
CREATE INDEX IF NOT EXISTS usage_records_job_idx      ON public.usage_records (job_id);
CREATE INDEX IF NOT EXISTS usage_records_tool_idx     ON public.usage_records (tool_id);
CREATE INDEX IF NOT EXISTS usage_records_recorded_idx ON public.usage_records (recorded_at DESC);

-- ---------------------------------------------------------------------------
-- audit_logs (append-only audit trail: actor, action, diff)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  actor_user_id uuid,                     -- NULL for api_key/system actors
  actor_type    public.actor_type NOT NULL DEFAULT 'system',
  action        text NOT NULL,            -- e.g. 'job.created', 'tool.state_changed'
  entity_type   text,                     -- e.g. 'execution_jobs', 'tools'
  entity_id     text,                     -- id of the affected row (text: covers uuids + slugs)
  diff          jsonb,                    -- { before, after } or free-form context
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_idx     ON public.audit_logs (org_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx  ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx  ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers (re-runnable via DROP + CREATE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations', 'organization_members', 'tools', 'integrations',
    'execution_jobs', 'approval_requests', 'generated_assets'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;
