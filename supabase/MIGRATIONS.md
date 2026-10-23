# Migrations — ATHENA TOOLS HUB

Fonte de verdade do esquema da base de dados. Ficheiros em `migrations/`,
numerados sequencialmente (`NNNN_name.sql`).

> ⚠️ **Estado de aplicação (alinhado na FASE 2B, C8):** as migrations
> `0001`–`0005` estão registadas como **aplicadas ao projeto live**
> (`https://bvsvqueeihljwksemfmz.supabase.co`) pela Cristiane em
> 2026-10-17 — é o registo dela; a **verificação viva independente
> continua pendente** (os scripts de auditoria corrigidos na Fase 2A
> aguardam execução dela). As `0006`–`0010` **NÃO foram aplicadas** —
> existem apenas como ficheiros. (A versão anterior deste aviso dizia
> "nenhuma foi aplicada", o que contradizia a tabela abaixo.)
> A aplicação é um passo manual da Cristiane no SQL editor do Supabase,
> **por ordem numérica**, depois de rever cada ficheiro. Ver
> "Ordem de aplicação" abaixo.

## Tabela de migrations

| #    | Ficheiro                    | O que faz                                                                                                                                                                                                                     | Estado |
|------|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| 0001 | `0001_core.sql`             | Schema nuclear: enums (`org_member_role`, `tool_state`, `integration_type`, `job_state`, `approval_status`, `actor_type`), tabelas `organizations`, `organization_members`, `tools`, `tool_capabilities`, `integrations`, `execution_jobs`, `execution_events`, `approval_requests`, `generated_assets`, `usage_records`, `audit_logs`; triggers `handle_updated_at()`. | ✅ aplicada no live (2026-10-17, pela Cristiane) |
| 0002 | `0002_rls.sql`              | RLS em todas as tabelas do core + helpers `current_org_ids()` / `has_org_role()` + `bootstrap_organization()` (criação atómica org+owner). Sem RLS aqui = sem tabela nova.                                                        | ✅ aplicada no live (2026-10-17) |
| 0003 | `0003_seed.sql`             | `seed_catalog(org_id)`: catálogo de tools com estados honestos (nunca `connected`/`operational-tested` sem teste real). Executar manualmente após bootstrap: `SELECT seed_catalog('<org-id>')`.                                   | ✅ aplicada no live (função criada; execução é passo da Cristiane) |
| 0004 | `0004_job_tool_slug.sql`    | Adiciona `execution_jobs.tool_slug` (o serviço endereça tools por slug).                                                                                                                                                        | ✅ aplicada no live (2026-10-17) |
| 0005 | `0005_security_hardening.sql` | Revisão de segurança: anti-escalada de privilégios (`guard_membership_write()`), `bootstrap_organization()` restrita a contexto administrativo (T2), guarda anti-referência cross-org (`enforce_same_org()`).                | ✅ aplicada no live (2026-10-17) |
| 0006 | `0006_profiles_roles.sql`   | **NOVO (Fase 2):** `profiles` (1 por auth user), `permissions` (catálogo global de 35 permissões) + `role_permissions` (matriz owner/admin/member/viewer). Seed idempotente da matriz.                                              | ⏳ **NÃO aplicada** — ficheiro apenas |
| 0007 | `0007_tool_lifecycle.sql`   | **NOVO (Fase 2):** `tool_categories` (taxonomia global, com seed), `tools.category_id` (FK opcional; coluna `category` legada intacta), `tool_versions` (histórico + 1 versão `is_current` por tool), `tool_installations` (tool por ambiente, UNIQUE org/tool/ambiente). | ⏳ **NÃO aplicada** — ficheiro apenas |
| 0008 | `0008_agents_missions.sql`  | **NOVO (Fase 2):** `agents`, `agent_tool_permissions` (escopos + teto de gasto), `missions` (idempotência por `(org_id, mission_key)`), `mission_steps` (passos ordenados → `execution_jobs`). Inclui `guard_mission_state()`: máquina de estados em-DB sem bypass. | ⏳ **NÃO aplicada** — ficheiro apenas |
| 0009 | `0009_execution_webhooks.sql` | **NOVO (Fase 2):** `job_attempts` (tentativas por job, append-only), `integration_endpoints` (endpoints concretos por integração), `webhooks` (inbound via `path_token` único; segredo NUNCA aqui, só `secret_ref` do vault), `webhook_deliveries` (log de entregas, append-only). | ⏳ **NÃO aplicada** — ficheiro apenas |
| 0010 | `0010_rls_phase2.sql`       | **NOVO (Fase 2):** RLS em todas as tabelas 0006–0009 (catálogos globais read-only; `profiles` self/org-shared; operacionais no modelo 0002; `agent_tool_permissions` escrita só owner/admin; `job_attempts`/`webhook_deliveries` append-only) + triggers `enforce_same_org()` em todos os pares FK novos. | ⏳ **NÃO aplicada** — ficheiro apenas |
| 0011 | `0011_api_keys.sql`         | **NOVO (Fase 2D, C5+C3b):** `api_keys` (hash UNIQUE c/ lookup O(1), expiração/revogação/rotação; fecha B5/B6) + `api_request_nonces` (anti-replay persistente insert-first; fecha metade de B2). RLS ativa com **zero policies** de propósito (fail-closed; acesso só service_role). Backfill dos hashes legados de `integrations.config`. Spec: `docs/FASE2C_C3_C5_SPEC.md`; plano/rollback: `docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md`. | ⏳ **PREPARADA na Fase 2D — NÃO aplicada** (aplicar = gate G2, decisão expressa da Cristiane) |

## Ordem de aplicação (quando a Cristiane decidir aplicar)

No SQL editor do projeto Supabase, **por ordem numérica estrita**:

```
0001 → 0002 → 0003 (só a função; a execução é separada)
→ 0004 → 0005 → 0006 → 0007 → 0008 → 0009 → 0010
→ 0011 (só com autorização expressa — gate G2 da Fase 2D)
```

Depois das migrations, os passos manuais já documentados continuam válidos:

1. `SELECT public.bootstrap_organization('Nome', 'slug', '<auth-user-id>');`
2. `SELECT public.seed_catalog('<org-id>');`
3. `supabase/verify_rls.sql` (somente-leitura) para auditoria.

Regras permanentes (de `supabase/README.md`): nunca editar migration já
aplicada — corrigir sempre para a frente com ficheiro novo; tabelas novas
sempre org-scoped (`org_id` FK `ON DELETE CASCADE`) e sempre com RLS;
migrations re-runnable (`IF NOT EXISTS` / `OR REPLACE` / `ON CONFLICT`).

## Mapeamento entidade pedida → tabela (Fase 2)

| Entidade pedida        | Tabela usada                    | Situação |
|------------------------|---------------------------------|----------|
| organizations          | `organizations`                 | já existia (0001) — reutilizada |
| organization_members   | `organization_members`          | já existia (0001) — reutilizada |
| profiles               | `profiles`                      | **nova (0006)** |
| roles/permissions      | `permissions` + `role_permissions` (+ enum `org_member_role` já existente) | **nova (0006)**; papéis já existiam |
| tools                  | `tools`                         | já existia (0001) — reutilizada |
| tool_versions          | `tool_versions`                 | **nova (0007)** |
| tool_categories        | `tool_categories`               | **nova (0007)** |
| tool_installations     | `tool_installations`            | **nova (0007)** |
| connectors             | `integrations`                  | já existia (0001) — reutilizada (uma integration *é* um conector configurado: provider + type + config não-secreta + teste) |
| connector_configs      | `integrations.config` (JSONB)   | já existia (0001) — reutilizada; segredos continuam no vault, nunca aqui |
| agents                 | `agents`                        | **nova (0008)** |
| agent_tool_permissions | `agent_tool_permissions`        | **nova (0008)** |
| missions               | `missions`                      | **nova (0008)** |
| mission_steps          | `mission_steps`                 | **nova (0008)** |
| jobs                   | `execution_jobs`                | já existia (0001) — reutilizada |
| job_attempts           | `job_attempts`                  | **nova (0009)** |
| job_events             | `execution_events`              | já existia (0001) — reutilizada (timeline append-only por job) |
| job_artifacts          | `generated_assets`              | já existia (0001) — reutilizada |
| approvals              | `approval_requests`             | existe no schema (0001) mas **NÃO é usada por código nenhum** (FASE 2B, C9): as aprovações operativas vivem no estado do job em `execution_jobs` (`PENDING_APPROVAL → QUEUED/CANCELLED`) + `audit_logs`; a coluna `expires_at` nunca é aplicada (sem TTL). Tabela reservada, não "reutilizada" |
| execution_logs         | `execution_events` (`type='log'`) | já existia (0001) — reutilizada (a tabela já prevê entradas `type='log'` com `message`+`payload`) |
| integration_endpoints  | `integration_endpoints`         | **nova (0009)** |
| webhooks               | `webhooks`                      | **nova (0009)** |
| webhook_deliveries     | `webhook_deliveries`            | **nova (0009)** |
| usage_records          | `usage_records`                 | já existia (0001) — reutilizada |
| cost_records           | `usage_records` (`cost_cents` + `currency`) | já existia (0001) — reutilizada (custo já é coluna nativa do usage) |
| audit_logs             | `audit_logs`                    | já existia (0001) — reutilizada |

Nada foi duplicado: onde o conceito já existia com outro nome, a tabela
existente foi reutilizada e o mapeamento está documentado acima.

## O que NÃO foi verificado nesta fase

- **Aplicação real no live:** a auditoria somente de leitura da Cristiane
  ao projeto Supabase dedicado (2026-10-23) confirmou a estrutura
  completa presente: 25/25 tabelas, 25/25 com RLS ativa, 82 policies na
  schema public, 102 associações papel-permissão (= seed da 0006) —
  ou seja, o schema de 0001–0010 existe na BD viva. Ressalva da própria
  auditoria: a presença da estrutura está provada; políticas, funções e
  triggers individuais e a integralidade de cada migration **não** foram
  validados objeto a objeto.
- **Testes de integração app↔DB:** `lib/db-types.ts` espelha 0001–0010
  desde a FASE 2C (C6) — 25 tabelas, 11 enums, 8 funções — com o teste
  anti-drift `tests/schema-types-consistency.test.ts` a derivar o schema
  das migrations e a falhar se os tipos divergirem.
- **`supabase/verify_rls.sql`:** continua a cobrir só as tabelas 0001;
  estender a auditoria às tabelas novas é follow-up sugerido.
