-- ===========================================================================
-- ATHENA TOOLS HUB — 0010_rls_phase2.sql
-- Row Level Security + cross-org reference guards for the phase-2 tables
-- (0006_profiles_roles, 0007_tool_lifecycle, 0008_agents_missions,
--  0009_execution_webhooks).
--
-- MODEL (same as 0002_rls.sql):
--   * Global catalogs (permissions, role_permissions, tool_categories):
--     SELECT for any authenticated user; NO app writes (migration-managed).
--   * profiles: a user reads their own profile + profiles of users who
--     share at least one organization; writes are self-only.
--   * Org-scoped operational tables: SELECT any org role (viewer included);
--     INSERT/UPDATE owner/admin/member; DELETE owner/admin.
--   * agent_tool_permissions: security-sensitive — SELECT any org role,
--     but ALL writes are owner/admin only (anti-escalation).
--   * job_attempts, webhook_deliveries: append-only for app users
--     (SELECT + INSERT only; no UPDATE/DELETE policies).
--   * enforce_same_org() triggers (from 0005) on every new FK pair:
--     a row may never reference a parent row of another organization.
--   * service_role bypasses RLS by design — server code MUST keep
--     enforcing org_id scoping in application logic.
--
-- Re-runnable: DROP POLICY IF EXISTS before every CREATE POLICY.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS on every new table
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_installations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Global catalogs: read-only for app users (managed by migrations)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['permissions', 'role_permissions', 'tool_categories'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t || '_ro', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_ro_select', t);
  END LOOP;
END $$;
-- No INSERT/UPDATE/DELETE policies: only migration/trusted contexts write.

-- ---------------------------------------------------------------------------
-- profiles: self + org-shared visibility; self-only writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members AS m1
      JOIN public.organization_members AS m2 ON m2.org_id = m1.org_id
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = profiles.user_id
    )
  );

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Org-scoped operational tables (standard rw model, same as 0002):
--   tool_versions, tool_installations, agents, missions, mission_steps,
--   integration_endpoints, webhooks
--
-- SELECT: any role in the org (viewer included).
-- INSERT/UPDATE: owner/admin/member.
-- DELETE: owner/admin only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tool_versions', 'tool_installations', 'agents', 'missions',
    'mission_steps', 'integration_endpoints', 'webhooks'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t || '_rw', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (org_id IN (SELECT public.current_org_ids()))',
      t || '_rw_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t || '_rw', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''member'']))',
      t || '_rw_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_update ON public.%I', t || '_rw', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''member'']))
       WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''member'']))',
      t || '_rw_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_delete ON public.%I', t || '_rw', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
       USING (public.has_org_role(org_id, ARRAY[''owner'',''admin'']))',
      t || '_rw_delete', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- agent_tool_permissions — security-sensitive: writes are owner/admin only.
-- (A member who could grant an agent access to tools could bypass the
--  approval/spend gates.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agent_tool_permissions_select ON public.agent_tool_permissions;
CREATE POLICY agent_tool_permissions_select ON public.agent_tool_permissions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS agent_tool_permissions_insert ON public.agent_tool_permissions;
CREATE POLICY agent_tool_permissions_insert ON public.agent_tool_permissions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS agent_tool_permissions_update ON public.agent_tool_permissions;
CREATE POLICY agent_tool_permissions_update ON public.agent_tool_permissions
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS agent_tool_permissions_delete ON public.agent_tool_permissions;
CREATE POLICY agent_tool_permissions_delete ON public.agent_tool_permissions
  FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- job_attempts, webhook_deliveries — append-only for app users
-- (SELECT + INSERT only; status updates happen via service_role)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_attempts', 'webhook_deliveries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t || '_append', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (org_id IN (SELECT public.current_org_ids()))',
      t || '_append_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_insert ON public.%I', t || '_append', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public.has_org_role(org_id, ARRAY[''owner'',''admin'',''member'']))',
      t || '_append_insert', t);
  END LOOP;
END $$;
-- No UPDATE / DELETE policies: history is immutable for app users.

-- ---------------------------------------------------------------------------
-- enforce_same_org() triggers (cross-organization reference guard, 0005)
-- Every new FK's org must equal the row's org. Re-runnable via DROP IF EXISTS.
-- ---------------------------------------------------------------------------

-- tool_versions.tool_id        -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.tool_versions;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.tool_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- tool_installations.tool_id   -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.tool_installations;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.tool_installations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- tool_installations.version_id -> tool_versions
DROP TRIGGER IF EXISTS enforce_same_org_version ON public.tool_installations;
CREATE TRIGGER enforce_same_org_version
  BEFORE INSERT OR UPDATE OF version_id, org_id ON public.tool_installations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('version_id', 'tool_versions');

-- agent_tool_permissions.agent_id -> agents
DROP TRIGGER IF EXISTS enforce_same_org_agent ON public.agent_tool_permissions;
CREATE TRIGGER enforce_same_org_agent
  BEFORE INSERT OR UPDATE OF agent_id, org_id ON public.agent_tool_permissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('agent_id', 'agents');

-- agent_tool_permissions.tool_id -> tools
DROP TRIGGER IF EXISTS enforce_same_org_tool ON public.agent_tool_permissions;
CREATE TRIGGER enforce_same_org_tool
  BEFORE INSERT OR UPDATE OF tool_id, org_id ON public.agent_tool_permissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('tool_id', 'tools');

-- missions.agent_id            -> agents
DROP TRIGGER IF EXISTS enforce_same_org_agent ON public.missions;
CREATE TRIGGER enforce_same_org_agent
  BEFORE INSERT OR UPDATE OF agent_id, org_id ON public.missions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('agent_id', 'agents');

-- mission_steps.mission_id     -> missions
DROP TRIGGER IF EXISTS enforce_same_org_mission ON public.mission_steps;
CREATE TRIGGER enforce_same_org_mission
  BEFORE INSERT OR UPDATE OF mission_id, org_id ON public.mission_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('mission_id', 'missions');

-- mission_steps.job_id         -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.mission_steps;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.mission_steps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- job_attempts.job_id          -> execution_jobs
DROP TRIGGER IF EXISTS enforce_same_org_job ON public.job_attempts;
CREATE TRIGGER enforce_same_org_job
  BEFORE INSERT OR UPDATE OF job_id, org_id ON public.job_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('job_id', 'execution_jobs');

-- integration_endpoints.integration_id -> integrations
DROP TRIGGER IF EXISTS enforce_same_org_integration ON public.integration_endpoints;
CREATE TRIGGER enforce_same_org_integration
  BEFORE INSERT OR UPDATE OF integration_id, org_id ON public.integration_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('integration_id', 'integrations');

-- webhooks.integration_id      -> integrations
DROP TRIGGER IF EXISTS enforce_same_org_integration ON public.webhooks;
CREATE TRIGGER enforce_same_org_integration
  BEFORE INSERT OR UPDATE OF integration_id, org_id ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('integration_id', 'integrations');

-- webhook_deliveries.webhook_id -> webhooks
DROP TRIGGER IF EXISTS enforce_same_org_webhook ON public.webhook_deliveries;
CREATE TRIGGER enforce_same_org_webhook
  BEFORE INSERT OR UPDATE OF webhook_id, org_id ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org('webhook_id', 'webhooks');

-- ===========================================================================
-- Sanity reminders (unchanged semantics, restated for the reviewer):
-- * service_role bypasses RLS by design — server code MUST keep enforcing
--   org_id scoping in application logic.
-- * guard_mission_state() (0008) binds every caller including service_role:
--   illegal state transitions are always rejected in-database.
-- * Trigger functions (RETURNS trigger) are inert outside trigger context;
--   they keep their default EXECUTE grants so user writes can fire them.
-- ===========================================================================
