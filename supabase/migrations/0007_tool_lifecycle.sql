-- ===========================================================================
-- ATHENA TOOLS HUB — 0007_tool_lifecycle.sql
-- Tool versioning, normalized categories, and installations.
--
-- WHAT THIS ADDS
--   * public.tool_categories — GLOBAL taxonomy of tool categories
--     (no org_id). Seeded with the canonical categories already used by
--     0003_seed.sql. Application code may add more via migration only;
--     app users get SELECT, never writes.
--   * public.tools.category_id — optional FK to tool_categories, added via
--     ALTER (the legacy free-text tools.category column from 0001 is kept
--     untouched as a display label).
--   * public.tool_versions — version history per tool: semver-ish label,
--     changelog, config schema, honest state, and a single "current"
--     version per tool (partial unique index).
--   * public.tool_installations — a tool version installed into an
--     environment of an org (local/staging/production). UNIQUE per
--     (org, tool, environment): one active installation per environment.
--
-- HONEST STATES: a version is never marked 'connected'/'operational-tested'
-- without a real passing test (same rule as tools.state in 0001/0003).
--
-- Re-runnable: guarded enum creation, IF NOT EXISTS everywhere, guarded
-- seed inserts, constraint creation guarded by a pg_constraint check.
-- RLS: see 0010_rls_phase2.sql (never ship a table without RLS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum types (guarded: re-runnable)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.installation_state AS ENUM (
    'installed',
    'updating',
    'failed',
    'removed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- tool_categories (global taxonomy — no org_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,               -- e.g. 'video'
  name        text NOT NULL,
  description text,
  icon        text,                               -- icon name or emoji
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the canonical categories already referenced by 0003_seed.sql.
INSERT INTO public.tool_categories (slug, name, description, icon, sort_order)
VALUES
  ('design-vectors', 'Design vetorial', 'Vector graphics and layout tools', 'pen-tool', 10),
  ('image-photo',    'Imagem e foto',   'Photo editing and AI image tools',  'image',    20),
  ('video',          'Vídeo',           'Video generation, editing and rendering', 'clapperboard', 30),
  ('audio',          'Áudio',           'Voice, TTS and audio editing tools', 'mic',      40),
  ('documents',      'Documentos',      'Text, copy and document tools',     'file-text', 50),
  ('automation',     'Automação',       'Scraping, browser and workflow automation', 'bot', 60),
  ('data',           'Dados',           'Databases, spreadsheets and analytics', 'database', 70),
  ('communication',  'Comunicação',     'Email, messaging and publishing tools', 'send', 80)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- tools.category_id (optional FK; legacy text column kept untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tools
  ADD COLUMN IF NOT EXISTS category_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tools_category_id_fkey'
  ) THEN
    ALTER TABLE public.tools
      ADD CONSTRAINT tools_category_id_fkey
      FOREIGN KEY (category_id)
      REFERENCES public.tool_categories (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tools_category_id_idx
  ON public.tools (category_id);

-- ---------------------------------------------------------------------------
-- tool_versions (org-scoped version history per tool)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tool_id       uuid NOT NULL REFERENCES public.tools (id) ON DELETE CASCADE,
  version       text NOT NULL,                    -- e.g. '1.4.0'
  changelog     text,
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  state         public.tool_state NOT NULL DEFAULT 'in-development',
  is_current    boolean NOT NULL DEFAULT false,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_versions_tool_version_unique UNIQUE (tool_id, version)
);
CREATE INDEX IF NOT EXISTS tool_versions_org_idx  ON public.tool_versions (org_id);
CREATE INDEX IF NOT EXISTS tool_versions_tool_idx ON public.tool_versions (tool_id);

-- Exactly one current version per tool.
CREATE UNIQUE INDEX IF NOT EXISTS tool_versions_single_current
  ON public.tool_versions (tool_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- tool_installations (org-scoped: tool version per environment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_installations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tool_id       uuid REFERENCES public.tools (id) ON DELETE SET NULL,
  version_id    uuid REFERENCES public.tool_versions (id) ON DELETE SET NULL,
  environment   text NOT NULL DEFAULT 'production', -- e.g. 'local','staging','production'
  status        public.installation_state NOT NULL DEFAULT 'installed',
  config        jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret config only; secrets live in the vault
  installed_by  uuid,
  installed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_installations_org_tool_env_unique UNIQUE (org_id, tool_id, environment)
);
CREATE INDEX IF NOT EXISTS tool_installations_org_idx     ON public.tool_installations (org_id);
CREATE INDEX IF NOT EXISTS tool_installations_tool_idx    ON public.tool_installations (tool_id);
CREATE INDEX IF NOT EXISTS tool_installations_version_idx ON public.tool_installations (version_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (re-runnable via DROP + CREATE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tool_versions', 'tool_installations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;
