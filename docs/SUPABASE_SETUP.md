# Supabase setup — ATHENA TOOLS HUB

> **Estado atual (FASE 2B, C8):** a decisão já foi tomada — EXISTE um
> projeto Supabase **dedicado** ao Tools Hub
> (`https://bvsvqueeihljwksemfmz.supabase.co`); nunca reutilizar a base
> de outro produto. As migrations `0001`–`0005` estão registadas como
> aplicadas pela Cristiane (2026-10-17; verificação viva independente
> pendente — ver `supabase/MIGRATIONS.md`); as `0006`–`0010` são
> ficheiros apenas. Sem as env vars, a app corre sem base de dados e
> mostra o estado honesto "not connected" (`isSupabaseConfigured()`).
> (A versão anterior deste cabeçalho dizia "decisão pendente / só
> migrations" — estava desatualizada face ao estado medido.)

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
| `0003_seed.sql`   | Defines `seed_catalog(org_id)` (org-scoped catalog, verified licenses) |
| `0004_job_tool_slug.sql` | Adds `tool_slug` to `execution_jobs`    |
| `0005_security_hardening.sql` | REVOKEs `bootstrap_organization`, role-escalation trigger, cross-org FK triggers |
| `0006_profiles_roles.sql` | `profiles`, `permissions`, `role_permissions` — **ficheiro apenas, NÃO aplicado** |
| `0007_tool_lifecycle.sql` | `tool_categories`, `tool_versions`, `tool_installations` — **ficheiro apenas, NÃO aplicado** |
| `0008_agents_missions.sql` | `agents`, `agent_tool_permissions`, `missions`, `mission_steps` — **ficheiro apenas, NÃO aplicado** |
| `0009_execution_webhooks.sql` | `job_attempts`, `integration_endpoints`, `webhooks`, `webhook_deliveries` — **ficheiro apenas, NÃO aplicado** |
| `0010_rls_phase2.sql` | RLS das tabelas 0006–0009 — **ficheiro apenas, NÃO aplicado** |

As cinco primeiras são re-runnable e estão registadas como aplicadas
(2026-10-17). Verify in **Table editor** that the 11 tables of `0001`
exist (`organizations`, `organization_members`, `tools`,
`tool_capabilities`, `integrations`, `execution_jobs`, `execution_events`,
`approval_requests`, `generated_assets`, `usage_records`, `audit_logs`).
As `0006`–`0010` acrescentariam 14 tabelas (25 no total) — só depois de
aplicadas, o que ainda não aconteceu. Estado completo e autoritativo:
`supabase/MIGRATIONS.md`.

## 3. Create the first organization + user

1. In the dashboard → **Authentication** → **Users** → create (or invite)
   the owner's user.
2. The owner signs in to the app once; then, in the SQL editor, run:

   ```sql
   -- creates the org and makes the signed-in user its owner
   -- (get the user id from Dashboard → Authentication → Users)
   select public.bootstrap_organization('Ofensiva Criativa', 'ofensiva-criativa', '<auth-user-id>');
   ```

   `bootstrap_organization(name, slug, user_id)` is defined in `0002_rls.sql`
   and hardened in `0005_security_hardening.sql`. It is the only supported way
   to create the first org + owner membership, because RLS forbids users from
   inserting their own membership rows.

   Security: `EXECUTE` is REVOKED from `PUBLIC`/`anon`/`authenticated`, and
   the function rejects any call carrying a user JWT — it runs ONLY in the
   SQL editor (postgres) or via `service_role`. There is no public
   org-creation endpoint.
3. Seed the catalog for the new org:

   ```sql
   select public.seed_catalog('<org-id-from-step-2>');
   ```

   The catalog is **org-scoped** (each org gets its own copy with independent
   states). Licenses seeded are the verified values from
   `docs/CATALOG_LICENSES.md`; re-running never overwrites `state`,
   `license` or `license_verified`.

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
6. **Full attack matrix** — run `supabase/verify_rls.sql` (all six attack
   scenarios: privilege escalation, cross-org reads, cross-org FK smuggling,
   `bootstrap_organization` abuse, viewer mutation, member approval). Every
   attack must be BLOCKED with the expected error/zero-rows outcome.

## 6. When Supabase is NOT configured

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
