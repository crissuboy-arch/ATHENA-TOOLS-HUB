-- ===========================================================================
-- ATHENA TOOLS HUB — 0006_profiles_roles.sql
-- User profiles + fine-grained permission model.
--
-- WHAT THIS ADDS
--   * public.profiles — one row per Supabase auth user (display name,
--     avatar, locale). No FK to auth.users on purpose, same convention as
--     organization_members.user_id in 0001_core.sql.
--   * public.permissions — GLOBAL catalog of fine-grained permission codes
--     (e.g. 'tools.write', 'approvals.decide'). No org_id: the catalog is
--     identical for every organization.
--   * public.role_permissions — maps each org_member_role
--     ('owner'|'admin'|'member'|'viewer') to the permissions it grants.
--     This is the application-level authorization matrix; RLS policies
--     (0002_rls.sql + 0010_rls_phase2.sql) stay authoritative in the DB.
--
-- DESIGN NOTES
--   * The permission matrix mirrors the RLS semantics of 0002_rls.sql:
--     member = read + create/update operational rows; admin = + delete +
--     member management + approval decisions; owner = + org delete +
--     role assignment. Application code should check role_permissions
--     before acting; the database enforces the same via RLS.
--   * Anti-escalation: granting 'owner' or changing roles stays guarded by
--     guard_membership_write() (0005) + members.assign_roles (owner-only).
--   * Seed data below is idempotent (ON CONFLICT ... DO NOTHING) and only
--     touches descriptive rows — it never changes existing grants.
--
-- Re-runnable: every CREATE uses IF NOT EXISTS / OR REPLACE.
-- RLS: see 0010_rls_phase2.sql (never ship a table without RLS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE,             -- auth.users.id (intentionally no FK)
  display_name  text,
  avatar_url    text,
  locale        text,                             -- e.g. 'pt-BR'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- NOTE: user_id UNIQUE already creates its backing index; no extra index.

-- ---------------------------------------------------------------------------
-- permissions (global catalog — no org_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,               -- e.g. 'tools.write'
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- role_permissions (global matrix: org role -> permission)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          public.org_member_role NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_role_permission_unique UNIQUE (role, permission_id)
);
CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
  ON public.role_permissions (permission_id);

-- ---------------------------------------------------------------------------
-- Seed: permission catalog (idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (code, description)
VALUES
  ('org.read',            'View organization details'),
  ('org.update',          'Update organization name and settings'),
  ('org.delete',          'Delete the organization (owner only)'),
  ('members.read',        'List organization members'),
  ('members.invite',      'Invite members to the organization'),
  ('members.remove',      'Remove members from the organization'),
  ('members.assign_roles','Assign or change member roles (owner only)'),
  ('tools.read',          'View the tool catalog'),
  ('tools.write',         'Create and update tools and capabilities'),
  ('tools.delete',        'Delete tools from the catalog'),
  ('tools.install',       'Install tool versions into an environment'),
  ('integrations.read',   'View integrations'),
  ('integrations.write',  'Create and update integrations'),
  ('integrations.delete', 'Delete integrations'),
  ('integrations.test',   'Run connection tests on integrations'),
  ('jobs.read',           'View execution jobs'),
  ('jobs.create',         'Create execution jobs'),
  ('jobs.cancel',         'Cancel running jobs'),
  ('approvals.request',   'Request human approval'),
  ('approvals.decide',    'Approve or reject approval requests'),
  ('assets.read',         'View generated assets'),
  ('assets.write',        'Create and update generated assets'),
  ('assets.delete',       'Delete generated assets'),
  ('usage.read',          'View usage records'),
  ('costs.read',          'View cost records'),
  ('audit.read',          'View the audit log'),
  ('agents.read',         'View agents'),
  ('agents.write',        'Create and update agents and their tool permissions'),
  ('agents.run',          'Run missions through an agent'),
  ('missions.read',       'View missions and their steps'),
  ('missions.create',     'Create missions'),
  ('missions.cancel',     'Cancel missions'),
  ('webhooks.read',       'View webhooks and deliveries'),
  ('webhooks.write',      'Create and update webhooks'),
  ('webhooks.delete',     'Delete webhooks')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: role -> permission matrix (idempotent)
-- Mirrors 0002_rls.sql: viewer = read-only; member = read + create/update
-- operational rows; admin = + delete + member management + approval
-- decisions; owner = + org delete + role assignment.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, permission_id)
SELECT v.role::public.org_member_role, p.id
FROM (VALUES
  -- viewer: read-only
  ('viewer','org.read'),('viewer','members.read'),('viewer','tools.read'),
  ('viewer','integrations.read'),('viewer','jobs.read'),('viewer','assets.read'),
  ('viewer','usage.read'),('viewer','costs.read'),('viewer','audit.read'),
  ('viewer','agents.read'),('viewer','missions.read'),('viewer','webhooks.read'),
  -- member: viewer + operational create/update
  ('member','org.read'),('member','members.read'),('member','tools.read'),
  ('member','tools.write'),('member','tools.install'),
  ('member','integrations.read'),('member','integrations.test'),
  ('member','jobs.read'),('member','jobs.create'),('member','jobs.cancel'),
  ('member','approvals.request'),
  ('member','assets.read'),('member','assets.write'),
  ('member','usage.read'),('member','costs.read'),('member','audit.read'),
  ('member','agents.read'),('member','agents.run'),
  ('member','missions.read'),('member','missions.create'),('member','missions.cancel'),
  ('member','webhooks.read'),
  -- admin: member + delete + member management + approval decisions
  ('admin','org.read'),('admin','org.update'),
  ('admin','members.read'),('admin','members.invite'),('admin','members.remove'),
  ('admin','tools.read'),('admin','tools.write'),('admin','tools.delete'),('admin','tools.install'),
  ('admin','integrations.read'),('admin','integrations.write'),
  ('admin','integrations.delete'),('admin','integrations.test'),
  ('admin','jobs.read'),('admin','jobs.create'),('admin','jobs.cancel'),
  ('admin','approvals.request'),('admin','approvals.decide'),
  ('admin','assets.read'),('admin','assets.write'),('admin','assets.delete'),
  ('admin','usage.read'),('admin','costs.read'),('admin','audit.read'),
  ('admin','agents.read'),('admin','agents.write'),('admin','agents.run'),
  ('admin','missions.read'),('admin','missions.create'),('admin','missions.cancel'),
  ('admin','webhooks.read'),('admin','webhooks.write'),('admin','webhooks.delete'),
  -- owner: admin + org delete + role assignment
  ('owner','org.read'),('owner','org.update'),('owner','org.delete'),
  ('owner','members.read'),('owner','members.invite'),('owner','members.remove'),
  ('owner','members.assign_roles'),
  ('owner','tools.read'),('owner','tools.write'),('owner','tools.delete'),('owner','tools.install'),
  ('owner','integrations.read'),('owner','integrations.write'),
  ('owner','integrations.delete'),('owner','integrations.test'),
  ('owner','jobs.read'),('owner','jobs.create'),('owner','jobs.cancel'),
  ('owner','approvals.request'),('owner','approvals.decide'),
  ('owner','assets.read'),('owner','assets.write'),('owner','assets.delete'),
  ('owner','usage.read'),('owner','costs.read'),('owner','audit.read'),
  ('owner','agents.read'),('owner','agents.write'),('owner','agents.run'),
  ('owner','missions.read'),('owner','missions.create'),('owner','missions.cancel'),
  ('owner','webhooks.read'),('owner','webhooks.write'),('owner','webhooks.delete')
) AS v(role, code)
JOIN public.permissions p ON p.code = v.code
ON CONFLICT (role, permission_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- updated_at trigger (re-runnable via DROP + CREATE)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
