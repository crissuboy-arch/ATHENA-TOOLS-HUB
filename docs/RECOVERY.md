# RECOVERY — recuperação e rollback

> Quando algo parte: respira, não apagues nada, segue o cenário abaixo.
> Regra de ouro: **recuperar com trilha auditável** — `audit_logs` e
> `execution_events` são append-only; nunca reescrever história para "limpar".

---

## 1. Cenários e resposta

### A. Projeto Supabase pausado (o mais provável no free tier)

**Sintoma:** as chamadas à API começam a falhar com timeouts/erros de
conexão e a app mostra estados de erro, MAS o `/api/v1/health` pode
continuar a responder `supabase:"configured"` — esse campo só reflete a
presença das env vars (`isSupabaseConfigured()`), NÃO faz ping ao banco.
O sinal fiável da pausa é o estado `Paused` no dashboard do Supabase
(ou `supabase:"not-configured"` no health, que indica outra coisa: env
vars em falta).

**Causa provável:** 7 dias sem pedidos → Supabase pausa o projeto free.

**Recuperação:**
1. Dashboard Supabase → projeto → **Restore / Resume** (1 clique).
2. Aguardar o cold start (10–30s no primeiro pedido).
3. `curl https://<dominio>/api/v1/health` → `supabase:"configured"`.
4. Se pausas são frequentes: ou aceita-se (uso interno esporádico) ou sobe-se
   para Pro ($25/mês, sem pausa) — decisão dela (ver `docs/COSTS.md`).

### B. App fora do ar na Vercel

**Sintoma:** domínio não responde / 5xx.

1. Vercel → projeto → **Deployments** → ver o deploy atual: build falhou?
   Logs do Runtime com erros?
2. **Rollback imediato (código):** no deployment anterior estável → **⋯ →
   Promote to Production**. Isto não mexe no banco — só no código.
   (Nunca "Redeploy" do deploy partido; promove-se o último bom.)
3. Se o erro é de env var (ex.: `SUPABASE_SERVICE_ROLE_KEY` errada):
   Settings → Environment Variables → corrigir → **redeploy** (env vars
   `NEXT_PUBLIC_*` são inlined no build — mudar exige novo build).
4. Validar com os health checks de `docs/DEPLOY_PREP.md` §4.

### C. Chave/segredo exposto ou suspeito

**Sintoma:** `service_role` ou API key de integração apareceu onde não devia
(chat, log, repo, screenshot).

1. **Rodar imediatamente:**
   - Supabase: Project Settings → API → **regenerar** a chave afetada
     (`anon` ou `service_role`).
   - Integração Athena: `UPDATE integrations SET state='unavailable'` para a
     integração da chave — a revogação é imediata porque `verifyApiKey` só
     aceita `state='connected'` (drift `status` × `state` corrigido no
     código na Fase 1; ver `docs/ATHENA_MANUAL.md` §1); emitir nova
     (processo em `docs/ATHENA_INTEGRATION.md`).
2. Atualizar o novo valor na Vercel (Environment Variables) + `.env.local`.
3. Redeploy (por causa do `NEXT_PUBLIC_*`, se a `anon` mudou).
4. Registar o incidente (o quê, quando, que chave, rotação feita) — fora do git.
5. **Nunca** tentar "apagar" do git com force-push se já foi pushed: a chave
   considera-se queimada e roda-se na mesma.

### D. Dados errados no banco (seed, org, catálogo)

1. Diagnosticar com SELECTs read-only no SQL editor.
2. Corrigir com SQL cirúrgico + registar o que foi feito.
3. `seed_catalog(org_id)` é **idempotente e não sobrescreve** `state`,
   `license` nem `license_verified` — pode re-correr-se em segurança.
4. `bootstrap_organization` só corre no SQL editor / `service_role` (revogado
   para `PUBLIC`/`anon`/`authenticated` na migration 0005) — não há risco de
   criação de orgs pela app.

### E. Vercel bateu num limite do Hobby

**Sintoma:** projeto pausado / 503 em tudo / builds rejeitados.

Ver `docs/COSTS.md` e `docs/OPERATIONS.md` §8: no Hobby não há cobrança —
o projeto **pausa até ao próximo ciclo**. Ação: identificar o recurso
(bandwidth? invocations? builds?), reduzir, e aguardar o reset; se for
recorrente, discutir Pro ($20/user/mês) com ela. Sem cartão registado, não
há fatura surpresa — mas também não há "pagar para continuar".

---

## 2. Rollback de migrations (banco)

Factos:
- Existem **10 migrations** (`0001`–`0010`). As `0001`–`0005` estão
  registadas como aplicadas no live (2026-10-17; ver
  `supabase/MIGRATIONS.md`); as `0006`–`0010` são ficheiros apenas. São
  **re-runnable** (idempotentes) onde aplicável, mas **não têm `down`
  migrations** — não existe "desfazer 0004" automático.
- Nunca editar um arquivo de migration já aplicado no live e re-aplicar.

**Procedimento correto (para a frente, não para trás):**
1. Identificar a migration problemática e o sintoma (logs, `verify_rls.sql`).
2. Escrever uma **nova** migration corretiva **`0011_<assunto>.sql`** —
   o próximo número livre (FASE 2B: a versão antiga deste documento dizia
   `0006_`, mas `0006`–`0010` já estão ocupados por migrations reais;
   reutilizar um número partiria a ordem e o histórico).
3. Testar a corretiva **primeiro** num projeto Supabase à parte (free permite
   2 projetos/org — usar o segundo como "staging" descartável).
4. Aplicar no live via SQL editor, na ordem; correr `verify_rls.sql` depois.
5. Se a corretiva for arriscada: **restaurar backup primeiro** — mas o free
   tier **não tem backups automáticos** (ver §5). Sem backup, a corretiva tem
   de ser cirúrgica e testada. É por isto que o §5 existe.

**Rollback de dados (não de schema):** restaurar via backup/export manual.
`audit_logs`/`execution_events` não se apagam pelo fluxo normal — um
"rollback" que apague auditoria é proibido.

---

## 3. Rollback de código (app)

1. O deploy na Vercel é por branch (`feat/mvp-foundation`).
2. Para reverter: `git revert <commit>` na branch (novo commit — **nunca
   force-push**, nunca reescrever história), push, a Vercel faz redeploy;
   ou **Promote to Production** de um deployment anterior no dashboard
   (mais rápido, sem git).
3. A `main` fica intocada para sempre — não é via de rollback nem de deploy.

---

## 4. Perda total (plano de reconstrução)

Se o projeto Vercel e/ou Supabase se perderem:

1. **Código**: o repo `crissuboy-arch/ATHENA-TOOLS-HUB` (branch
   `feat/mvp-foundation`) é a fonte — clonar de novo chega.
2. **Banco**: criar novo projeto Supabase dedicado → aplicar `0001`–`0010`
   por ordem (`docs/SUPABASE_SETUP.md` §2) — a lista antiga (`0001`–`0005`)
   deixava 14 das 25 tabelas de fora → `bootstrap_organization` →
   `seed_catalog` → recriar utilizadores/integrações (as chaves API têm de ser
   **re-emitidas** — só hashes viviam no banco) → `verify_rls.sql`.
3. **Segredos**: todos re-obtidos das fontes (dashboard Supabase, emissor de
   chaves) — nenhum segredo vive no repo, por desenho.
4. **Tempo estimado**: < 1h se as migrations e este documento estiverem
   atuais. O elo fraco é o **backup dos dados** (§5).

---

## 5. Backups (a parte honesta)

- **Supabase free: sem backups automáticos.** Se os dados do Hub passarem a
  ter valor (jobs, aprovações, auditoria), isto é o risco nº 1.
- **Mitigação sem custo (manual):** exportação periódica via SQL editor
  (`COPY (SELECT ...) TO STDOUT`) ou `pg_dump` com a connection string
  (modo session, porta 5432) para arquivo local cifrado. Frequência a
  decidir com ela (sugestão: semanal quando houver atividade).
- **Mitigação paga:** Supabase Pro ($25/mês/projeto) inclui backups diários
  automáticos com 7 dias de retenção. Decisão dela — ver `docs/COSTS.md`.
- **O que NUNCA vai para backup:** segredos (chaves Supabase, API keys
  cruas). Backups guardam hashes e dados — segredos re-emitem-se.

---

## 6. Contactos e acessos (preencher fora do git)

- Dono do projeto Vercel: (conta dela)
- Dono do projeto Supabase: (conta dela)
- Repo: `crissuboy-arch/ATHENA-TOOLS-HUB` (branch `feat/mvp-foundation`)
- Este arquivo **não** contém segredos — e nunca vai conter.
