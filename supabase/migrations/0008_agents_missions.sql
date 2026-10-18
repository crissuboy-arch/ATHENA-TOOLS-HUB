-- ===========================================================================
-- ATHENA TOOLS HUB — 0008_agents_missions.sql
-- Agents, agent tool permissions, missions and mission steps.
--
-- WHAT THIS ADDS
--   * public.agents — agent definitions (name, backend, state, config).
--     An agent is the executor identity behind missions.
--   * public.agent_tool_permissions — which tools an agent may use, with
--     scope allow-list and an optional per-execution spend cap.
--     Security-sensitive: writes are owner/admin-only (see 0010).
--   * public.missions — a unit of requested work. Idempotency is enforced
--     per (org_id, mission_key): re-sending the same mission key never
--     creates a duplicate mission.
--   * public.mission_steps — ordered steps of a mission; each step may be
--     executed as an execution_jobs row (mission_steps.job_id).
--
-- STATE MACHINE (enforced in-DB by guard_mission_state(), no bypass):
--   created -> planned | cancelled
--   planned -> running | cancelled
--   running -> waiting_approval | completed | failed | cancelled
--   waiting_approval -> running | completed | failed | cancelled
--   failed  -> planned (retry) | cancelled
--   completed, cancelled are terminal.
-- New rows always start in 'created'.
--
-- Re-runnable: guarded enum creation, IF NOT EXISTS / OR REPLACE / DROP IF
-- EXISTS before every CREATE.
-- RLS: see 0010_rls_phase2.sql (never ship a table without RLS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum types (guarded: re-runnable)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.mission_state AS ENUM (
    'created',
    'planned',
    'running',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_state AS ENUM (
    'active',
    'paused',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  backend     text NOT NULL DEFAULT 'athena',    -- e.g. 'athena', 'claude-code', 'custom'
  state       public.agent_state NOT NULL DEFAULT 'active',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret config only
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_org_slug_unique UNIQUE (org_id, slug)
);
CREATE INDEX IF NOT EXISTS agents_org_idx ON public.agents (org_id);

-- ---------------------------------------------------------------------------
-- agent_tool_permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_tool_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  agent_id       uuid NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  tool_id        uuid NOT NULL REFERENCES public.tools (id) ON DELETE CASCADE,
  allowed        boolean NOT NULL DEFAULT true,
  scopes         text[] NOT NULL DEFAULT '{}',   -- allowed capability names; empty = all
  max_cost_cents integer NOT NULL DEFAULT 0,     -- per-execution spend cap (minor units); 0 = no cap set
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_permissions_agent_tool_unique UNIQUE (agent_id, tool_id)
);
CREATE INDEX IF NOT EXISTS agent_tool_permissions_org_idx   ON public.agent_tool_permissions (org_id);
CREATE INDEX IF NOT EXISTS agent_tool_permissions_agent_idx ON public.agent_tool_permissions (agent_id);
CREATE INDEX IF NOT EXISTS agent_tool_permissions_tool_idx  ON public.agent_tool_permissions (tool_id);

-- ---------------------------------------------------------------------------
-- missions (idempotent per org via mission_key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.missions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  mission_key text NOT NULL,                     -- caller-provided idempotency key, unique per org
  title       text NOT NULL,
  description text,
  state       public.mission_state NOT NULL DEFAULT 'created',
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority    integer NOT NULL DEFAULT 0,
  requested_by uuid,
  agent_id    uuid REFERENCES public.agents (id) ON DELETE SET NULL,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missions_org_key_unique UNIQUE (org_id, mission_key)
);
CREATE INDEX IF NOT EXISTS missions_org_idx     ON public.missions (org_id);
CREATE INDEX IF NOT EXISTS missions_state_idx   ON public.missions (state);
CREATE INDEX IF NOT EXISTS missions_agent_idx   ON public.missions (agent_id);
CREATE INDEX IF NOT EXISTS missions_created_idx ON public.missions (created_at DESC);

-- ---------------------------------------------------------------------------
-- mission_steps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mission_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  mission_id  uuid NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  step_order  integer NOT NULL,                  -- 0-based execution order
  label       text NOT NULL,
  action      jsonb NOT NULL DEFAULT '{}'::jsonb,-- the step definition (tool slug, params, gates)
  state       public.mission_state NOT NULL DEFAULT 'created',
  job_id      uuid REFERENCES public.execution_jobs (id) ON DELETE SET NULL,
  result      jsonb,
  error       jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mission_steps_mission_order_unique UNIQUE (mission_id, step_order)
);
CREATE INDEX IF NOT EXISTS mission_steps_org_idx     ON public.mission_steps (org_id);
CREATE INDEX IF NOT EXISTS mission_steps_mission_idx ON public.mission_steps (mission_id);
CREATE INDEX IF NOT EXISTS mission_steps_job_idx     ON public.mission_steps (job_id);

-- ---------------------------------------------------------------------------
-- guard_mission_state(): in-database state-machine enforcement for
-- missions and mission_steps. Unlike the 0005 privilege guards, this one
-- has NO trusted-context bypass: the state machine binds every caller,
-- including service_role, because an illegal transition is always a bug.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_mission_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'created' THEN
      RAISE EXCEPTION 'mission state: new % rows must start in ''created'' (got %)',
        TG_TABLE_NAME, NEW.state;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    v_allowed := CASE OLD.state
      WHEN 'created'          THEN ARRAY['planned', 'cancelled']
      WHEN 'planned'          THEN ARRAY['running', 'cancelled']
      WHEN 'running'          THEN ARRAY['waiting_approval', 'completed', 'failed', 'cancelled']
      WHEN 'waiting_approval' THEN ARRAY['running', 'completed', 'failed', 'cancelled']
      WHEN 'failed'           THEN ARRAY['planned', 'cancelled']
      ELSE ARRAY[]::text[]
    END;
    IF NOT (NEW.state::text = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'mission state: illegal transition % -> % on %',
        OLD.state, NEW.state, TG_TABLE_NAME;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_mission_state ON public.missions;
CREATE TRIGGER guard_mission_state
  BEFORE INSERT OR UPDATE ON public.missions
  FOR EACH ROW EXECUTE FUNCTION public.guard_mission_state();

DROP TRIGGER IF EXISTS guard_mission_state ON public.mission_steps;
CREATE TRIGGER guard_mission_state
  BEFORE INSERT OR UPDATE ON public.mission_steps
  FOR EACH ROW EXECUTE FUNCTION public.guard_mission_state();

-- ---------------------------------------------------------------------------
-- updated_at triggers (re-runnable via DROP + CREATE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agents', 'agent_tool_permissions', 'missions', 'mission_steps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;
