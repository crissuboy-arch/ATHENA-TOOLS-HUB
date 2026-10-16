# supabase/

Database sources of truth for ATHENA TOOLS HUB. Migrations only — no live
project is connected here (see `docs/SUPABASE_SETUP.md`).

## Layout

```
supabase/
  README.md              # this file — conventions
  migrations/
    0001_core.sql        # schema: tables, enums, triggers
    0002_rls.sql         # row-level security for every table
    0003_seed.sql        # tool catalog seed (honest states only)
```

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
5. Apply order matters: run files in numeric order (`0001` → `0002` → `0003`).
