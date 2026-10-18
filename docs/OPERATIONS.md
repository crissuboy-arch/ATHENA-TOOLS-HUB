# OPERATIONS — guia de operação diária

> Público: a proprietária (opera os consoles) e quem executar o Hub.
> Setup inicial: `docs/SUPABASE_SETUP.md` · Deploy: `docs/DEPLOY_PREP.md` ·
> Custos: `docs/COSTS.md` · Recuperação: `docs/RECOVERY.md`.

---

## 1. O que corre onde (mapa honesto do MVP)

| Peça | Onde corre | Notas |
|---|---|---|
| UI (Next.js) + API `/api/v1` | Vercel (quando houver deploy) ou `npm run dev` local | Server Components + Route Handlers |
| Job engine (máquina de estados) | **Dentro** das API routes — não há processo separado | `lib/jobs/machine.ts`; transições via API |
| Banco (11 tabelas, RLS) | Supabase dedicado `https://bvsvqueeihljwksemfmz.supabase.co` | Pausa após 7 dias sem tráfego (free tier!) |
| **Worker de execução** | **NÃO EXISTE no MVP** | `integrationStatus:"pending"` = nenhum executor ligado; `execute()` dos adapters lança `NOT_IMPLEMENTED` |

Consequência prática: no MVP, jobs **não executam sozinhos**. Vão até
`PENDING_APPROVAL` → `QUEUED` e ficam lá, honestamente, até um executor real
existir. Nada é simulado como "concluído".

---

## 2. Rotina diária (5 minutos)

1. **Supabase dashboard → projeto** — está `Active` ou `Paused`?
   Free tier pausa após 7 dias sem pedidos; retomar é 1 clique
   (**Restore**), mas o primeiro pedido demora 10–30s (cold start).
2. **Vercel dashboard → Usage** — confirmar que nada bateu nos limites do
   Hobby (ver `docs/COSTS.md`). Limite batido = projeto pausa até ao próximo
   ciclo (sem cobrança).
3. **App → Aprovações** — há pedidos `PENDING_APPROVAL` à espera de decisão
   humana? Aprovar/rejeitar com justificativa (obrigatória, 1–2000 chars).
4. **App → Jobs** — algum job em `FAILED` com `errorMessage`? Registar e
   investigar; o histórico vive em `execution_events` (append-only).

## 3. Rotina semanal (15 minutos)

- **Supabase → Database → Usage**: tamanho da DB < 500 MB? (limite free).
- **Supabase → Storage**: < 1 GB? (o MVP ainda não usa Storage — confirmar que
  continua a 0).
- **Vercel → Logs**: erros 5xx? Rate limits (429) a disparar?
- **Rever `audit_logs`** (via SQL editor): ações sensíveis
  (`approval.granted/rejected`, `integration.*`) com ator e timestamp.
- **Confirmar backups**: o free tier NÃO tem backups automáticos — se houve
  dados novos importantes, exportar (ver `docs/RECOVERY.md` §5).

---

## 4. Correr localmente (desenvolvimento)

```bash
cp .env.example .env.local   # preencher as 3 chaves Supabase (nunca commitar)
npm install
npm run dev                  # http://localhost:3000
```

Sem as chaves, a app corre em modo **"Banco de dados não conectado"**
(`isSupabaseConfigured() === false`) — estados honestos na UI, sem dados
falsos. Com as chaves, reinicia o `dev` após gravar o `.env.local`.

Comandos úteis:

```bash
npm test          # 122 testes (vitest)
npm run typecheck # tsc --noEmit (0 erros)
npm run lint      # eslint (0 erros)
npm run build     # build de produção local
npm start         # serve o build (requer as env vars de produção)
```

---

## 5. O futuro worker de jobs (quando existir um executor real)

> Estado: **não implementado**. Esta secção é o plano de operação, não uma
> descrição do presente. Não prometer worker a ninguém até existir código.

**Porquê fora da Vercel:** funções serverless no Hobby têm duração máxima
curta (~10s) e não há processos background. Execução de ferramentas
(vídeo, scrapers, MCP) precisa de um processo longo — logo, corre **fora**
da Vercel.

**Onde correr (opções, por decidir com ela):**
- Máquina local dela (simples; só corre quando o PC está ligado);
- VPS isolada (não a VPS de produção da Athena — regra dura);
- RunPod / GPU (para vídeo pesado, ex.: o PoC do MKVideos usou RunPod RTX A5000).

**Como vai funcionar (contrato planeado):**
1. Processo Node/CLI faz poll a `execution_jobs` (`status='QUEUED'`) com
   `FOR UPDATE SKIP LOCKED` ou equivalente — um job, um worker.
2. Executa o adapter real da ferramenta (`lib/adapters/*`).
3. Escreve progresso em `execution_events` e o resultado em
   `generated_assets` / `execution_jobs.result`; transições via máquina de
   estados (`lib/jobs/machine.ts`) — nunca UPDATE direto de `status`.
4. Logs: estruturados (JSON) para stdout + linhas em `execution_events`
   (visíveis na UI em `/jobs/{id}/events`).

**Variáveis do worker (quando existir):** as mesmas 3 do Supabase
(`SUPABASE_SERVICE_ROLE_KEY` server-only) + variáveis do provider do adapter
(ex.: token do provider — **sempre** server-only, **sempre** com
`maxCostCents` obrigatório no contrato do job; ver esqueleto `apify-mcp`).

**Regras do worker (herdadas das regras dela):**
- Nenhuma execução sem teto de gasto aprovado.
- Segredos via env/vault — nunca na tabela `integrations.config`
  (ver `docs/SUPABASE_SETUP.md` § Security notes).
- Falha de provider = `FAILED` com `errorMessage` real; nunca "sucesso" falso.

---

## 6. Gestão de integrações (chaves API da Athena)

O processo manual está em `docs/ATHENA_INTEGRATION.md` § "Emissão de chaves".
Resumo operacional:

- **Criar**: gerar com `generateApiKey()` (`lib/api-keys.ts`) → gravar **só o
  hash SHA-256** em `integrations.config.apiKeyHash` + scopes em
  `integrations.config.scopes`, `state` inicial (ver bloqueador em
  `docs/ATHENA_MANUAL.md` §1) → entregar a chave crua
  **uma única vez** (arquivo/vault, nunca chat, nunca git).
- **Revogar**: `UPDATE integrations SET state='unavailable' WHERE id=...`
  (ver bloqueador do drift `status` × `state` em `docs/ATHENA_MANUAL.md` §1 —
  até à correção no código, a autenticação por API key está inoperante).
- **Auditar**: chaves nunca aparecem em logs/banco (só hashes).

## 7. Logs e observabilidade (o que há hoje)

- **Correlação**: todo erro de API segue `{ error: { code, message, requestId } }`
  + header `x-request-id`. Usa o `requestId` para ligar UI ↔ Vercel logs ↔ banco.
- **Vercel**: dashboard → projeto → **Logs** (runtime + build). Free: retenção
  curta — para incidentes, copiar o trecho relevante na hora.
- **Supabase**: dashboard → **Logs** (Postgres/Auth/API). Free: **1 dia** de
  retenção — não serve como arquivo; o arquivo real é `audit_logs` no banco.
- **Banco (arquivo real)**: `audit_logs` e `execution_events` são append-only
  para utilizadores da app (sem policies de UPDATE/DELETE); só `service_role`
  reescreve. Consultar via SQL editor.

## 8. Limites operacionais a vigiar (free tiers)

| Sinal | Onde ver | Ação |
|---|---|---|
| Projeto Supabase `Paused` | Dashboard Supabase | **Restore** (1 clique); avisar que o cold start demora |
| DB perto de 500 MB | Database → Usage | Limpar `usage_records`/`execution_events` antigos **ou** subir para Pro ($25/mês) — decisão dela |
| Egress perto de 5 GB/mês | Project Settings → Usage | Reduzir payloads / cache; ou Pro |
| 429 `RATE_LIMITED` na API | Vercel logs / header `Retry-After` | 120 req/60s por identidade — normal em polling agressivo; espaçar |
| 401 `REPLAY_DETECTED` | Vercel logs | Cliente a reutilizar `X-Nonce` — bug no cliente, não no Hub |
