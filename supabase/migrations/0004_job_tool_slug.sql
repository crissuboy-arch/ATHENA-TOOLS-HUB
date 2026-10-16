-- ---------------------------------------------------------------------------
-- ATHENA TOOLS HUB — migration 0004: tool_slug on execution_jobs
-- ---------------------------------------------------------------------------
-- The job service addresses tools by slug (e.g. 'vectorcraft'), which is
-- UNIQUE per org in public.tools. tool_id (uuid FK) stays nullable for
-- tools known only to the local catalog; tool_slug preserves the intent
-- so jobs are never blocked by a missing catalog row.

ALTER TABLE public.execution_jobs
  ADD COLUMN IF NOT EXISTS tool_slug text;

CREATE INDEX IF NOT EXISTS execution_jobs_tool_slug_idx
  ON public.execution_jobs (tool_slug);
