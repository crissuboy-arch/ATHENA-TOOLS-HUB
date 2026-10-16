-- ATHENA TOOLS HUB — 0002_rls.sql
-- Row Level Security for every table in the core schema.
--
-- Model:
--   * Users only access rows of organizations they belong to
--     (via public.organization_members, user_id = auth.uid()).
--   * Role-based access: viewer = read-only; member = read + create/update
--     operational rows; admin = manage members, delete; owner = full control
--     incl. deleting organizations.
--   * audit_logs and execution_events are append-only for app users
--     (no UPDATE/DELETE policies; only service_role can rewrite history).
--   * service_role bypasses RLS automatically (Supabase-managed role).
--
-- The helper functions are SECURITY DEFINER owned by the migration role
-- (postgres in the Supabase SQL editor), so they bypass RLS and cannot
-- recurse infinitely.
-- Re-runnable: all statements use CREATE OR REPLACE / DROP IF EXISTS.

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tools                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_capabilities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER — bypass RLS, no recursion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id
  FROM public.organization_members
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND role::text = ANY (p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- bootstrap_organization: creates an org AND makes the given user its owner,
-- atomically. Needed because RLS forbids users from inserting themselves
-- into organization_members (only owner/admin may do that).
-- p_user_id is explicit because auth.uid() is NULL when run as postgres in
-- the SQL editor. Run it in the SQL editor with the user's auth id:
--   SELECT public.bootstrap_organization('Ofensiva Criativa', 'ofensiva-criativa', '<auth-user-id>');
-- (Find the id in Dashboard → Authentication → Users.)
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

-- Intentionally NOT granted to PUBLIC/authenticated/anon: only the database
-- owner (SQL editor) may call it. There is no public org-creation endpoint.

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_org_ids()));

-- Direct INSERT is not granted; use bootstrap_organization().
DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner']));

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_select ON public.organization_members;
CREATE POLICY org_members_select ON public.organization_members
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS org_members_insert ON public.organization_members;
CREATE POLICY org_members_insert ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS org_members_update ON public.organization_members;
CREATE POLICY org_members_update ON public.organization_members
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS org_members_delete ON public.organization_members;
CREATE POLICY org_members_delete ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    public.has_org_role(org_id, ARRAY['owner', 'admin'])
    -- a user may always remove themselves
    OR user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Org-scoped operational tables:
--   tools, tool_capabilities, integrations, execution_jobs, generated_assets,
--   usage_records, approval_requests
--
-- SELECT: any role in the org (viewer included).
-- INSERT/UPDATE: owner/admin/member.
-- DELETE: owner/admin only.
-- (approval_requests UPDATE is restricted below to owner/admin for decisions.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tools', 'tool_capabilities', 'integrations', 'execution_jobs',
    'generated_assets', 'usage_records', 'approval_requests'
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

-- Approval decisions (UPDATE on approval_requests) are reserved to
-- owner/admin: drop the generic member UPDATE and replace it.
DROP POLICY IF EXISTS approval_requests_rw_update ON public.approval_requests;
CREATE POLICY approval_requests_update_owner_admin ON public.approval_requests
  FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- execution_events — append-only timeline
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS execution_events_select ON public.execution_events;
CREATE POLICY execution_events_select ON public.execution_events
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS execution_events_insert ON public.execution_events;
CREATE POLICY execution_events_insert ON public.execution_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin', 'member']));
-- No UPDATE / DELETE policies: history is immutable for app users.

-- ---------------------------------------------------------------------------
-- audit_logs — append-only audit trail
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_org_ids()));

DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner', 'admin', 'member']));
-- No UPDATE / DELETE policies: the audit trail is immutable for app users.

-- ---------------------------------------------------------------------------
-- Sanity note
-- ---------------------------------------------------------------------------
-- The Supabase service_role key bypasses RLS entirely. Server-side code that
-- uses createServiceClient() (lib/supabase.ts) must therefore enforce
-- org scoping in application logic. Never expose the service_role key to
-- the browser (it is NOT NEXT_PUBLIC_*).
