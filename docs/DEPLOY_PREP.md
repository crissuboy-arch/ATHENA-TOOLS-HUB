# DEPLOY PREP — ATHENA TOOLS HUB

> **Preparar ≠ executar.** Este documento deixa tudo pronto para o deploy na
> Vercel. **Nada aqui faz deploy.** O deploy continua BLOQUEADO até autorização
> explícita da proprietária, caso a caso (regra permanente de 2026-10-18).
>
> Documentos irmãos (ler antes, não duplicados aqui):
> - `docs/GO_LIVE_CHECKLIST.md` — passo a passo dela no dashboard Supabase
>   (criar admin, org, seed, chaves) + plano de testes funcionais.
> - `docs/SUPABASE_SETUP.md` — setup do banco, ordem das migrations, RLS.
> - `docs/COSTS.md` — custos honestos (o que é grátis vs. o que pode custar).
> - `docs/OPERATIONS.md` — operação diária pós-deploy.
> - `docs/RECOVERY.md` — recuperação e rollback.

Branch de trabalho: `feat/mvp-foundation` (a `main` fica intocada para sempre).
Gates medidos em 2026-10-18: 129/129 (gates da FASE 1) PASS · tsc 0 · eslint 0 ·
build PASS. Suite completa medida na auditoria de 2026-10-23: **452/452 testes
PASS · tsc 0 · eslint 0 · build PASS.**

---

## 1. Pré-requisitos (todos têm de estar PASS antes de pedir o go)

| # | Check | Estado 2026-10-18 |
|---|-------|-------------------|
| 1 | Gates locais: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` | PASS (suite completa 452/452 medida em 2026-10-23; gates FASE 1: 129/129) |
| 2 | Migrations 0001–0005 aplicadas no projeto dedicado `https://bvsvqueeihljwksemfmz.supabase.co` | Aplicadas por ela em 2026-10-17 (confirmado por ela) |
| 3 | Utilizador admin + organização + seed do catálogo | PENDENTE DELA — ver `docs/GO_LIVE_CHECKLIST.md` §1–2 |
| 4 | Chaves Supabase no `.env.local` e app local sem aviso "não conectado" | PENDENTE DELA — ver `docs/GO_LIVE_CHECKLIST.md` §3 |
| 5 | `supabase/verify_rls.sql` corrido contra o banco live (todos ATTACKs BLOCKED) | NÃO VERIFICADO |
| 6 | Plano de testes funcionais (`GO_LIVE_CHECKLIST.md` §4) | NÃO VERIFICADO |

**Blockers conhecidos** (não quebram o build, mas contam para o go/no-go):
- **Drift `status` × `state` em `integrations` — CORRIGIDO na FASE 1
  (`76e3969`, 2026-10-18):** `lib/api-keys.ts` (`verifyApiKey`) filtrava
  `.eq("status", "active")` contra uma coluna inexistente; hoje filtra
  `.eq("state", "connected")` contra a coluna real `state` (enum
  `tool_state`, migration 0001) — só integrações em `state='connected'`
  autenticam. Coberto por testes anti-drift e de round-trip
  (`lib/api-keys.test.ts`). **Já não é bloqueador** da integração Athena.
  Ver `docs/ATHENA_MANUAL.md` §1–§2.
- Drift de tipos: `tool_slug` em falta no tipo `ExecutionJob` em `lib/db-types.ts`
  (a coluna existe na migration 0004; o tipo TS ainda não a declara).

Sem os itens 3–6, o deploy sobe uma app "não conectada" — tecnicamente sobe,
mas é má ideia ir live assim. Recomendação: deploy de staging/preview primeiro.

---

## 2. Checklist de variáveis de ambiente

Copiar de `.env.example`. Valores reais **nunca** no git, **nunca** no chat.

| Variável | Obrigatória | Server-only? | Onde configurar | Notas |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Não (pública) | Vercel → Env Vars (Production, Preview) + `.env.local` | `https://bvsvqueeihljwksemfmz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Não (pública, RLS protege) | idem | Dashboard Supabase → Project Settings → API → `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | **SIM — nunca expor** | idem | `service_role secret`; bypassa RLS; só em `lib/supabase.ts` server-side |
| `NEXT_PUBLIC_APP_URL` | Recomendada | Não | Vercel (Production) | Domínio final, ex. `https://athena-tools-hub.vercel.app` |

Regras:
- `NEXT_PUBLIC_*` são **inlined no build**: mudar o valor exige **redeploy**.
- `SUPABASE_SERVICE_ROLE_KEY` nunca com prefixo `NEXT_PUBLIC_*`, nunca no browser.
- Na Vercel, marcar `SUPABASE_SERVICE_ROLE_KEY` como sensível; não a colar em
  Preview se o preview for partilhado (usar o mesmo projeto Supabase só se
  for aceitável — ver §6 sobre staging).

---

## 3. Configuração na Vercel (quando ela autorizar)

1. Vercel dashboard → **Add New → Project** → importar
   `crissuboy-arch/ATHENA-TOOLS-HUB`, branch **`feat/mvp-foundation`**
   (NÃO `main`).
2. Framework preset: **Next.js** (detetado automaticamente). Root directory: `./`.
   Build command e output: defaults (`next build`).
3. **Environment Variables** → adicionar as 4 da tabela do §2
   (Production; repetir em Preview se fizer sentido).
4. **Regions**: default (iad1). Não há requisito de região no MVP.
5. **NÃO** ativar: Vercel Postgres/KV/Blob (nada do MVP precisa),
   Password Protection pago, Analytics pago. Tudo o que custa fica desligado
   até decisão explícita dela.
6. Deploy → **aguardar build PASS** → correr os health checks do §4.

**`vercel.json`**: intencionalmente **não existe** neste repo. O MVP não precisa
de rewrites, headers, redirects nem cron — tudo o que o deploy precisa vive
no dashboard (env vars) e no código. Se um dia for preciso (ex.: cron de
polling), cria-se então, com justificação.

---

## 4. Health checks (correr logo após o deploy)

```bash
BASE=https://<o-teu-dominio-vercel>

# 1) Health — sem auth. Esperado: 200 + {"status":"ok","version":"0.1.0",
#    "supabase":"configured"|"not-configured","timestamp":"..."}
curl -s $BASE/api/v1/health | head -c 300; echo

# 2) Catálogo sem auth — esperado: 401 (auth obrigatória). Se der 200 com dados,
#    algo está errado na camada de auth.
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/v1/tools

# 3) UI — esperado: 200 na home; /app/* sem sessão responde 307 para /login
#    (quando o Supabase está configurado) — ver proxy.ts. Sem -L para ver o redirect.
curl -s -o /dev/null -w "%{http_code}\n" $BASE/
curl -s -o /dev/null -w "%{http_code}\n" $BASE/app
```

Critério PASS: health `200` + `supabase:"configured"` (só depois das chaves),
`/api/v1/tools` → `401`, home → `200`.

---

## 5. Smoke tests pós-deploy (com Supabase configurado)

Pré-requisito: `GO_LIVE_CHECKLIST.md` §1–3 feitos (admin, org, seed, chaves).
Substitui `<API_KEY>` por uma chave de integração real (ver
`docs/ATHENA_INTEGRATION.md` — emissão manual) e `<ORG_ID>` pelo org id.

```bash
BASE=https://<o-teu-dominio-vercel>
TS=$(date +%s); NONCE=$(cat /proc/sys/kernel/random/uuid)

# 1) Criar job (idempotente) — esperado: 201 (primeira vez)
curl -s -X POST $BASE/api/v1/jobs \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "X-Request-Timestamp: $TS" -H "X-Nonce: $NONCE" \
  -d '{"orgId":"<ORG_ID>","toolId":"vectorcraft","idempotencyKey":"'"$NONCE"'",
       "params":{"prompt":"smoke test","maxCostCents":1}}' | head -c 400; echo

# 2) Poll do job — esperado: 200 com status PENDING_APPROVAL (MVP: sem executor
#    real, o job NÃO avança sozinho — integrationStatus:"pending" é honesto)
#    curl $BASE/api/v1/jobs/<JOB_ID>?orgId=<ORG_ID> -H "Authorization: Bearer <API_KEY>" ...

# 3) Fila de aprovações — esperado: 200 com o job pendente
#    curl "$BASE/api/v1/approvals?orgId=<ORG_ID>" -H "Authorization: Bearer <API_KEY>" ...

# 4) Repetir o passo 1 com o MESMO nonce — esperado: 401 REPLAY_DETECTED
#    (prova que o anti-replay funciona). Com nonce NOVO mas a MESMA idempotencyKey:
#    200 + "deduplicated":true (prova que a idempotência funciona).
```

Critério PASS: 201 → job criado; reenvio idempotente → `200` + `deduplicated:true`
(nonce novo, mesma idempotencyKey); nonce repetido → `401`.

---

## 6. Ordem de aplicação das migrations (referência)

A ordem canónica vive em `docs/SUPABASE_SETUP.md` §2 e nos arquivos em
`supabase/migrations/` (a Cristiane aplica manualmente no SQL editor):

1. `0001_core.sql` — tabelas, enums, triggers `updated_at`
2. `0002_rls.sql` — RLS em TODAS as tabelas + policies por papel
3. `0003_seed.sql` — função `seed_catalog(org_id)` (catálogo org-scoped)
4. `0004_job_tool_slug.sql` — `tool_slug` em `execution_jobs`
5. `0005_security_hardening.sql` — REVOKEs, trigger anti-escalação, FKs cross-org

(Todas re-runnable. Não existe `supabase/MIGRATIONS.md` no repo — a referência
viva é `SUPABASE_SETUP.md` §2.)

**Staging**: não existe projeto Supabase de staging. Recomendação honesta:
antes do primeiro deploy de produção, decidir com ela se se cria um segundo
projeto free (limite: 2 projetos ativos/org no free tier) para validar o ciclo
Athena sem tocar nos dados de produção. Estado: NÃO VERIFICADO / por decidir.

---

## 7. O que este MVP deliberadamente NÃO tem (não prometer)

- Executor real de jobs (`integrationStatus` fica `pending`; nada executa).
- Worker separado / background jobs (ver `docs/OPERATIONS.md`).
- Webhooks de conclusão (a Athena faz polling — ver `docs/ATHENA_MANUAL.md`).
- Rate limit e nonces anti-replay distribuídos (em memória; single-instance).
- Backups automáticos (Supabase free não tem — ver `docs/RECOVERY.md`).
