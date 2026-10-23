-- ===========================================================================
-- ATHENA TOOLS HUB — audit_0006_0010_readonly.sql
-- Verificação SOMENTE-LEITURA das migrations 0006–0010 no banco live.
-- Não altera nada: só SELECTs em catálogos do Postgres e contagens.
-- Corre no SQL Editor do Supabase e cola o output de volta.
-- FASE 2A (C7, 2026-10-23): expetativas corrigidas contra as migrations —
-- políticas da 0010 = 43 (não 16: os loops DO criam 4 por tabela
-- operacional) e role_permissions = 102 (não 113). Script NÃO executado.
-- ===========================================================================

-- 1. As 14 tabelas novas existem?
SELECT tablename AS tabela_nova
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles','permissions','role_permissions',
    'tool_categories','tool_versions','tool_installations',
    'agents','agent_tool_permissions','missions','mission_steps',
    'job_attempts','integration_endpoints','webhooks','webhook_deliveries')
ORDER BY tablename;
-- Esperado: 14 linhas.

-- 2. RLS ativo nas 14 tabelas?
SELECT tablename AS tabela, rowsecurity AS rls_ativo
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles','permissions','role_permissions',
    'tool_categories','tool_versions','tool_installations',
    'agents','agent_tool_permissions','missions','mission_steps',
    'job_attempts','integration_endpoints','webhooks','webhook_deliveries')
ORDER BY tablename;
-- Esperado: rls_ativo = true nas 14.

-- 3. Quantas políticas por tabela nova? (0010 cria 43 no total:
--    3 catálogos globais ×1 SELECT + profiles ×4 + 7 operacionais ×4
--    + agent_tool_permissions ×4 + 2 append-only ×2)
SELECT tablename AS tabela, count(*) AS politicas
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','permissions','role_permissions',
    'tool_categories','tool_versions','tool_installations',
    'agents','agent_tool_permissions','missions','mission_steps',
    'job_attempts','integration_endpoints','webhooks','webhook_deliveries')
GROUP BY tablename
ORDER BY tablename;
-- Esperado: soma = 43.

-- 4. Seeds da 0006/0007 (idempotentes)
SELECT 'permissions' AS seed, count(*) AS linhas FROM public.permissions;       -- esperado: 35
SELECT 'role_permissions' AS seed, count(*) AS linhas FROM public.role_permissions; -- esperado: 102 (viewer 12 + member 22 + admin 33 + owner 35)
SELECT 'tool_categories' AS seed, count(*) AS linhas FROM public.tool_categories;   -- esperado: 8

-- 5. Coluna nova da 0007 em tools
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tools' AND column_name = 'category_id';
-- Esperado: 1 linha (category_id, uuid).

-- 6. Tabelas operacionais vazias (nenhum dado real tocado)
SELECT 'agents' AS tabela, count(*) AS linhas FROM public.agents
UNION ALL SELECT 'missions', count(*) FROM public.missions
UNION ALL SELECT 'mission_steps', count(*) FROM public.mission_steps
UNION ALL SELECT 'job_attempts', count(*) FROM public.job_attempts
UNION ALL SELECT 'webhooks', count(*) FROM public.webhooks
UNION ALL SELECT 'webhook_deliveries', count(*) FROM public.webhook_deliveries
UNION ALL SELECT 'profiles', count(*) FROM public.profiles
UNION ALL SELECT 'tool_versions', count(*) FROM public.tool_versions
UNION ALL SELECT 'tool_installations', count(*) FROM public.tool_installations
UNION ALL SELECT 'integration_endpoints', count(*) FROM public.integration_endpoints
UNION ALL SELECT 'agent_tool_permissions', count(*) FROM public.agent_tool_permissions;
-- Esperado: 0 em todas (só seeds acima têm linhas).
