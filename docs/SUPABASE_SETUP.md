# Supabase setup — ATHENA TOOLS HUB

> **PENDING OWNER DECISION: Confirm whether a dedicated Supabase project for Tools Hub exists; never reuse another product's database without proper isolation and her explicit authorization.**

Until that decision is made, this project ships **migrations + docs only**.
No Supabase project is created or connected from this repo. The app runs
without a database and shows an honest "not connected" state
(`isSupabaseConfigured()` in `lib/supabase.ts`).

## 1. Create the dedicated project (owner action)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Name: `athena-tools-hub` (dedicated — do not reuse another product's project).
3. Choose region closest to the owner (EU).
4. Save the project URL, `anon` key and `service_role` key — **never commit
   them, never paste them in chat**.

## 2. Run the migrations (in order)

In the Supabase dashboard → **SQL editor**, run each file from
`supabase/migrations/` in numeric order:

| File              | What it does                                    |
| ----------------- | ----------------------------------------------- |
| `0001_core.sql`   | Tables, enums, `updated_at` triggers            |
| `0002_rls.sql`    | Enables RLS on ALL tables + role-based policies |
| `0003_seed.sql`   | Tool catalog seed (honest states only)          |

All three are re-runnable. Verify in **Table editor** that the 11 tables
exist (`organizations`, `organization_members`, `tools`,
`tool_capabilities`, `integrations`, `execution_jobs`, `execution_events`,
`approval_requests`, `generated_assets`, `usage_records`, `audit_logs`).

## 3. Create the first organization + user

1. In the dashboard → **Authentication** → **Users** → create (or invite)
   the owner's user.
2. The owner signs in to the app once; then, in the SQL editor, run:

   ```sql
   -- creates the org and makes the signed-in user its owner
   -- (get the user id from Dashboard → Authentication → Users)
   select public.bootstrap_organization('Ofensiva Criativa', 'ofensiva-criativa', '<auth-user-id>');
   ```

   `bootstrap_organization(name, slug)` is defined in `0002_rls.sql`. It is
   the only supported way to create the first org + owner membership,
   because RLS forbids users from inserting their own membership rows.
3. The `default` org created by `0003_seed.sql` holds the seeded catalog;
   the owner can delete it or keep it as a reference catalog.

## 4. Set the environment variables

Copy `.env.example` to `.env.local` (never commit `.env.local`) and fill:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # server only, never NEXT_PUBLIC_*
```

Restart `npm run dev` after changing env vars.

## 5. Verify RLS (honest states, no fakes)

Run these checks in the SQL editor and in the app:

1. **Policies exist** — every core table must have RLS enabled and at
   least one policy:
   ```sql
   select tablename, rowsecurity
   from pg_tables
   where schemaname = 'public'
     and tablename in ('organizations','organization_members','tools',
       'tool_capabilities','integrations','execution_jobs','execution_events',
       'approval_requests','generated_assets','usage_records','audit_logs');
   -- all rows must show rowsecurity = true
   ```
2. **Anon sees nothing** — with only the anon key (no login), every table
   query must return zero rows.
3. **Cross-org isolation** — create a second user in a second org and
   confirm they cannot read the first org's rows.
4. **Roles** — a `viewer` can read but gets denied on INSERT/UPDATE/DELETE;
   an approval can only be decided (`status` change) by `owner`/`admin`.
5. **Seed honesty** — `select slug, state from tools` must show only
   `cataloged`, `needs-config` or `in-development`. If anything reads
   `operational-tested` here, the seed was tampered with — investigate.

## 6. When Supabase is NOT configured (current state)

- `isSupabaseConfigured()` returns `false`.
- All Supabase client creators throw with a clear message pointing here.
- The app must render "Banco de dados não conectado" states — never fake
  rows, counts or statuses.

## Security notes

- `service_role` **bypasses RLS**. `createServiceClient()` is server-only;
  callers must enforce `org_id` scoping in code. Never expose the key to
  the browser (it is not `NEXT_PUBLIC_*`, never commit it).
- `audit_logs` and `execution_events` are append-only for app users (no
  UPDATE/DELETE policies); only `service_role` can rewrite history.
- Never store provider secrets in `integrations.config` — secrets belong
  to the vault / environment, never to the database.
