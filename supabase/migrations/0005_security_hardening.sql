-- ===========================================================================
-- ATHENA TOOLS HUB — 0005_security_hardening.sql
-- Security review fixes (owner review of commit 6247f8c). MUST run BEFORE
-- any Supabase project goes live.
--
-- THREAT MODEL (what this migration defends against):
--   * T1 — Privilege escalation via organization_members UPDATE:
--          an admin (or member, via a misconfigured policy) promotes
--          themselves or anyone else to 'owner'. Fixed by the
--          guard_membership_write() trigger (defense in depth, independent
--          of RLS policies): only an existing owner may change roles, owners
--          cannot change their own role, and the last owner can never be
--          removed.
--   * T2 — Unauthorized org creation / hostile takeover via
--          bootstrap_organization(): the function was SECURITY DEFINER with
--          only a comment claiming "not granted" — but PostgreSQL grants
--          EXECUTE to PUBLIC by default, so ANY authenticated user could call
--          it, and its ON CONFLICT DO UPDATE SET role='owner' clause meant
--          calling it with an EXISTING slug made the caller OWNER OF THAT
--          ORG. Fixed by explicit REVOKE + an in-function trusted-context
--          guard (auth.uid() must be NULL: SQL editor / service_role only).
--   * T3 — Cross-organization reference smuggling: several tables carry both
--          org_id and an FK (tool_id, integration_id, job_id). RLS gates
--          reads, but a direct INSERT could attach e.g. a job in org A to a
--          tool row of org B (FKs don't constrain org). Fixed by
--          enforce_same_org() triggers: every FK's org must equal the row's
--          org, verified inside the database regardless of the caller.
--
-- Re-runnable: DROP IF EXISTS before every CREATE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FIX 2a — bootstrap_organization: revoke EXECUTE from everyone.
-- PostgreSQL grants EXECUTE to PUBLIC by default; the old comment claiming
-- "intentionally NOT granted" was false — there was no REVOKE statement.
-- After this, only the function owner (postgres, i.e. the SQL editor) can
-- execute it. service_role is NOT granted either: there is no application
-- code path that calls this function (verified), so no legitimate caller
-- is broken.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bootstrap_organization(text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- FIX 2b — bootstrap_organization: trusted-context guard (defense in depth).
-- Even if a future GRANT re-exposed the function, any call carrying a user
-- JWT is rejected. Only the SQL editor (postgres, auth.uid() IS NULL) or
-- service_role may run it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_organization(p_name text, p_slug text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Trusted administrative context only (T2).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'bootstrap_organization: restricted to trusted administrative context (SQL editor / service_role)';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_organization requires a user id';
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (p_name, p_slug, p_user_id)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_org_id;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE slug = p_slug;
  END IF;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';

  RETURN v_org_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Explicit EXECUTE grants for the RLS helper functions.
-- RLS policies invoke these as the calling user, so `authenticated` needs
-- EXECUTE. Both are read-only and reveal ONLY the caller's own membership —
-- safe to expose.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.current_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- FIX 1 — guard_membership_write(): privilege-escalation guard for
-- organization_members (T1). Fires BEFORE INSERT/UPDATE/DELETE.
--
-- Rules enforced (for authenticated callers; trusted contexts bypass):
--   * INSERT with role='owner'  → caller must already be an owner of the org.
--   * UPDATE changing role      → caller must be an owner; owners can never
--                                  change their OWN role; the last owner of
--                                  an org can never be demoted/removed.
--   * DELETE of the last owner  → blocked (prevents orphaned orgs).
-- Non-role column updates still defer to the RLS policies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_membership_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role       text;
  v_remaining_owners integer;
BEGIN
  -- Trusted administrative context (service_role / SQL editor / migrations):
  -- RLS is bypassed there by design; this guard targets authenticated users.
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Granting 'owner' requires already being an owner (T1).
    IF NEW.role = 'owner' THEN
      SELECT role::text INTO v_actor_role
      FROM public.organization_members
      WHERE org_id = NEW.org_id AND user_id = auth.uid();
      IF v_actor_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'membership: only an existing owner can grant the owner role';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Non-role updates pass through; RLS policies decide who may update.
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
      RETURN NEW;
    END IF;

    SELECT role::text INTO v_actor_role
    FROM public.organization_members
    WHERE org_id = OLD.org_id AND user_id = auth.uid();
    IF v_actor_role IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'membership: role changes require the owner role (attempt blocked)';
    END IF;

    -- No self-demotion / self-promotion games.
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'membership: owners cannot change their own role';
    END IF;

    -- Never remove the last owner.
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.organization_members
      WHERE org_id = OLD.org_id AND role = 'owner' AND id <> OLD.id;
      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'membership: cannot remove the last owner of the organization';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.organization_members
      WHERE org_id = OLD.org_id AND role = 'owner' AND id <> OLD.id;
      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'membership: cannot delete the last owner of the organization';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_membership_write ON public.organization_members;
CREATE TRIGGER guard_membership_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_membership_write();

-- ---------------------------------------------------------------------------
-- FIX 3 — enforce_same_org(): cross-organization reference guard (T3).
-- Every row carrying both org_id and an FK must reference a parent in the
-- SAME organization. Verified inside the database via SECURITY DEFINER
-- (deterministic, independent of the caller's RLS view); fails closed.
-- TG_ARGV[0] = FK column on the child, TG_ARGV[1] = referenced table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_same_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fk_col  text := TG_ARGV[0];
  v_ref_tbl text := TG_ARGV[1];
  v_fk_val  uuid;
  v_ref_org uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', v_fk_col) USING NEW INTO v_fk_val;
  IF v_fk_val IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT org_id FROM public.%I WHERE id = $1', v_ref_tbl)
    USING v_fk_val INTO v_ref_org;

  IF v_ref_org IS NULL THEN
    RAISE EXCEPTION 'reference integrity: %.% references a missing row', TG_TABLE_NAME, v_fk_col;
  END IF;
  IF v_ref_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'reference integrity: cross-organization reference blocked (%.% points at a row of another organization)', TG_TABLE_NAME, v_fk_col;
  END IF;
  RETURN NEW;
END;
$$;

-- tool_capabilities.tool_id      -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.tool_capabilities;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.tool_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- execution_jobs.tool_id         -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.execution_jobs;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.execution_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- execution_jobs.integration_id  -> integrations
DROP TRIGGER IF EXISTS enforce_same_org_integration ON public.execution_jobs;
CREATE TRIGGER enforce_same_org_integration
  BEFORE INSERT OR UPDATE OF integration_id, org_id ON public.execution_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('integration_id', 'integrations');

-- execution_events.job_id        -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.execution_events;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.execution_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- approval_requests.job_id       -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.approval_requests;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- generated_assets.job_id        -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.generated_assets;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.generated_assets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- usage_records.job_id           -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.usage_records;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.usage_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- usage_records.tool_id          -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.usage_records;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.usage_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- ---------------------------------------------------------------------------
-- Sanity reminders (unchanged semantics, restated for the reviewer):
-- * service_role bypasses RLS by design — server code MUST keep enforcing
--   org_id scoping in application logic (see lib/api-auth.ts resolveOrgScope
--   and every .eq("org_id", …) in lib/jobs/service.ts).
-- * Trigger functions (RETURNS trigger) are inert outside trigger context;
--   they keep their default EXECUTE grants so user writes can fire them.
-- ===========================================================================
