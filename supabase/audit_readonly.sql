-- =============================================================
-- ATHENA TOOLS HUB — auditoria de compatibilidade e segurança
-- SOMENTE LEITURA: este script só faz SELECTs. Não altera nada.
-- Correr no SQL editor do Supabase (como postgres) e enviar o output.
-- =============================================================

-- A. Marcadores da migration 0005 (a mais crítica — revisão de segurança)
--    Se algum destes vier 'false', a 0005 NÃO foi aplicada.
SELECT 'A1 guard_membership_write trigger' AS check,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_membership_write') AS present
UNION ALL
SELECT 'A2 enforce_same_org_job trigger',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_same_org_job')
UNION ALL
SELECT 'A3 enforce_same_org_tool trigger',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_same_org_tool')
UNION ALL
SELECT 'A4 enforce_same_org_integration trigger',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_same_org_integration')
UNION ALL
SELECT 'A5 seed_catalog function (0003 nova)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'seed_catalog')
UNION ALL
SELECT 'A6 bootstrap_organization function (0002)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bootstrap_organization');

-- B. As 11 tabelas existem? RLS ativo em cada uma?
SELECT tablename,
       rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('organizations','organization_members','tools',
    'tool_capabilities','integrations','execution_jobs','execution_events',
    'approval_requests','generated_assets','usage_records','audit_logs')
ORDER BY tablename;

-- C. Políticas RLS por tabela (quem pode o quê)
SELECT tablename, policyname, cmd AS comando, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- D. Quem pode EXECUTAR as funções sensíveis?
--    Esperado após 0005: bootstrap_organization SEM grant para
--    PUBLIC/anon/authenticated (só postgres/service_role).
SELECT p.proname AS funcao, r.grantee, r.privilege_type
FROM information_schema.routine_privileges r
JOIN pg_proc p ON p.proname = r.routine_name
WHERE r.routine_schema = 'public'
  AND p.proname IN ('bootstrap_organization','seed_catalog')
ORDER BY p.proname, r.grantee;

-- E. Dados atuais: orgs, membros, utilizadores, ferramentas
SELECT 'organizations' AS tabela, count(*) AS linhas FROM public.organizations
UNION ALL SELECT 'organization_members', count(*) FROM public.organization_members
UNION ALL SELECT 'tools', count(*) FROM public.tools
UNION ALL SELECT 'auth.users', count(*) FROM auth.users;

-- F. Marcador da 0003 ANTIGA: org 'default' órfã?
--    Se existir slug='default' -> foi aplicada a 0003 antiga (antes da correção).
SELECT id, name, slug, created_at FROM public.organizations ORDER BY created_at;

-- G. Membros existentes (papéis)
SELECT om.role, count(*) AS n
FROM public.organization_members om
GROUP BY om.role;

-- H. Honestidade do catálogo: nenhum tool pode estar 'operational-tested' por seed
SELECT slug, state, license_verified, repo_url
FROM public.tools
ORDER BY slug;
