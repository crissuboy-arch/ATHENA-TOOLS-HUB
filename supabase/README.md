# supabase/

Database sources of truth for ATHENA TOOLS HUB. Migrations only — no live
project is connected here (see `docs/SUPABASE_SETUP.md`).

## Layout

```
supabase/
  README.md              # this file — conventions
  MIGRATIONS.md          # authoritative per-migration state (applied vs file-only)
  audit_readonly.sql     # read-only live audit (owner-run; expectations fixed in Fase 2A)
  verify_rls.sql         # RLS attack matrix (covers 0001 tables; see MIGRATIONS.md)
  migrations/
    0001_core.sql            # schema: tables, enums, triggers
    0002_rls.sql             # row-level security for every core table
    0003_seed.sql            # tool catalog seed (honest states only)
    0004_job_tool_slug.sql   # execution_jobs.tool_slug
    0005_security_hardening.sql # anti-escalation + cross-org FK guards
    0006_profiles_roles.sql  # profiles, permissions, role_permissions (NOT applied — file only)
    0007_tool_lifecycle.sql  # categories, versions, installations (NOT applied — file only)
    0008_agents_missions.sql # agents, missions, mission_steps (NOT applied — file only)
    0009_execution_webhooks.sql # attempts, endpoints, webhooks (NOT applied — file only)
    0010_rls_phase2.sql      # RLS for 0006–0009 tables (NOT applied — file only)
```

Application state per migration lives in `MIGRATIONS.md`: `0001`–`0005`
are recorded as applied by the owner (2026-10-17; independent live
verification pending); `0006`–`0010` are files only — do not treat their
tables as existing in the live database.

## Migration numbering convention

- Files are named `NNNN_name.sql`, numbered sequentially starting at `0001`.
- Numbers are zero-padded to 4 digits and **never reused or reordered**.
- A new change = a new file with the next number (`0004_...`, `0005_...`, ...).
- Never edit a migration that has already been applied to a shared database;
  fix forward with a new migration instead.
- `0002_rls.sql` is reserved for RLS: enabling it and all policies.
- `0003_seed.sql` (and any future `*_seed.sql`) holds catalog/seed data only.

## Rules

1. Migrations must be **re-runnable** where reasonable: use `IF NOT EXISTS`,
   `OR REPLACE`, `ON CONFLICT ... DO NOTHING/DO UPDATE`, and guarded
   `DO $$ ... EXCEPTION WHEN duplicate_object ... $$` blocks for enums.
2. New tables must be **org-scoped** (`org_id` FK to `organizations`,
   `ON DELETE CASCADE`) and get RLS policies in the same or a follow-up
   migration — never ship a table without RLS.
3. Seed data must use **honest states only** (`cataloged`, `needs-config`,
   `in-development`). Nothing is marked `connected` or `operational-tested`
   without a real passing integration test, and no license is marked
   verified before a human reviewed the actual LICENSE file.
4. No secrets in migrations. Service credentials belong to the vault / env,
   never to `config` JSONB columns (see `integrations.config` note in
   `0001_core.sql`).
5. Apply order matters: run files in numeric order (`0001` → `0010`; see
   the full order and per-file state in `MIGRATIONS.md`).
