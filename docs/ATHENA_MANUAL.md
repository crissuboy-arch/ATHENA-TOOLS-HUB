# ATHENA MANUAL — operar a integração Hub × Athena (lado Hub)

> **Manual do operador.** O contrato técnico vive em
> `docs/ATHENA_INTEGRATION.md` (rotas, auth, anti-replay, scopes, formatos) e
> no `openapi.yaml` — este documento **não duplica** esse contrato; diz
> **como operar** o lado Hub: que configurar, como registar a integração e
> como validar o ciclo missão → job → resultado em ambiente de teste.
>
> Estado honesto do MVP: o Hub **recebe e gere** missões/jobs; **não executa**
> (nenhum executor real ligado — `integrationStatus:"pending"`). A Athena
> (lado Cláudio) comanda via `/api/v1`; decisões de aprovação com efeito real
> exigem humano (`owner`/`admin`) — o Telegram nunca aprova sozinho.

---

## 1. O que configurar (lado Hub)

**Variáveis de ambiente:** as mesmas 3 do Supabase (`.env.example` /
`docs/DEPLOY_PREP.md` §2). **Não existe nenhuma env var específica da Athena
no MVP** — a integração vive no banco, não no ambiente:

| Onde | O quê |
|---|---|
| Tabela `integrations` | Uma linha por integração Athena (colunas reais: `org_id`, `name`, `provider`, `type='api'`, `state`, `config`) |
| `integrations.config.apiKeyHash` | **Só o hash SHA-256** da chave (nunca a chave crua) |
| `integrations.config.scopes` | Ex.: `["tools:read","jobs:read","jobs:write"]` (ver §3 — aprovações) |
| Fora do banco | A chave crua `hub_live_<64 hex>`, entregue **uma única vez** ao operador da Athena (arquivo/vault — nunca chat, nunca git) |

> ✅ **CORRIGIDO na FASE 1 (commit `76e3969`, 2026-10-18):** `lib/api-keys.ts`
> (`verifyApiKey`) filtrava por uma coluna `status` que **não existe** na
> tabela `integrations`. Hoje filtra `.eq("state", "connected")` contra a
> coluna real `state` (enum `tool_state` — ver migration 0001): **só
> integrações em `state='connected'` autenticam**; qualquer outro estado
> devolve 401 indistinguível. A correção é coberta por testes anti-drift e de
> round-trip (`lib/api-keys.test.ts`); gates da FASE 1: 129/129; suite
> completa medida na auditoria de 2026-10-23: 452/452. O passo 2 abaixo usa
> as colunas reais — o registo tem de ficar em `state='connected'` para a
> chave funcionar (ver §2).

**Checklist de rede/relógio (causa nº 1 de 401s):**
- O cliente Athena **tem** de enviar `X-Request-Timestamp` (unix seconds) e
  `X-Nonce` (uuid único) por requisição — tolerância **±5 min**.
- Relógios dessincronizados > 5 min ⇒ `401` sistemático. Sincronizar NTP dos
  dois lados antes de depurar qualquer outra coisa.

---

## 2. Registar a integração (passo a passo, operador Hub)

> Processo manual no MVP (não há UI de emissão de chaves). Fazer com calma —
> a chave crua só se mostra uma vez.

1. **Gerar o par** (na máquina local, repo clonado):
   ```bash
   node -e "import('./lib/api-keys.js').then(m => console.log(JSON.stringify(m.generateApiKey())))"
   # devolve { rawKey: 'hub_live_<64hex>', keyHash: '<sha256>' } (ver lib/api-keys.ts)
   ```
   (Se o import direto falhar por ser TS, gerar via `npx tsx` ou um script
   equivalente — o formato é o que importa: `hub_live_` + 64 hex, hash SHA-256.)
2. **Gravar no banco** (SQL editor do Supabase, como `service_role`/postgres —
   colunas reais da migration 0001):
   ```sql
   insert into public.integrations (org_id, name, provider, type, state, config)
   values ('<ORG_ID>', 'athena-control', 'athena', 'api', 'connected',
     jsonb_build_object(
       'apiKeyHash', '<KEY_HASH_DO_PASSO_1>',
       'scopes', '["tools:read","jobs:read","jobs:write"]'::jsonb
     ));
   ```
   (`state='connected'` é **obrigatório** para a chave autenticar —
   `verifyApiKey` só aceita esse estado. Se registares a integração antes de
   a ativar, usa um estado honesto (p. ex. `in-development`) e **promove para
   `connected` no momento da ativação**/entrega da chave — até lá, a chave
   devolve 401. `provider` é NOT NULL.)
3. **Entregar a chave crua** (`hub_live_...`) ao operador da Athena por canal
   seguro (arquivo para download / vault). **Nunca** no chat, nunca no git,
   nunca em logs. Ela não fica guardada em lado nenhum do Hub.
4. **Confirmar**: `select id, name, type, state from public.integrations;`
   → a linha existe com `type='api'`.
5. **Revogar** (quando preciso): `update public.integrations set
   state='unavailable' where id='<ID>';` — como `verifyApiKey` só aceita
   `state='connected'`, qualquer outro estado revoga a chave com efeito
   imediato (401 no pedido seguinte). Este é o interruptor de revogação.

---

## 3. Scopes: que dar à Athena

| Scope | Para quê | Dar? |
|---|---|---|
| `tools:read` | Ler catálogo (`GET /tools`) | Sim |
| `jobs:read` | Listar/poll jobs, events, assets | Sim |
| `jobs:write` | Criar/cancelar jobs | Sim |
| `approvals:decide` | Aprovar/rejeitar via API | **NÃO no MVP** |

**Porquê não `approvals:decide`:** aprovar dispara execução futura (e gasto).
No MVP as decisões são humanas na UI (`owner`/`admin`, com justificativa
obrigatória e registo em `audit_logs`). Dar `approvals:decide` a um agente
autónomo sem supervisão viola a regra dela — só com autorização explícita
dela, e mesmo assim com âmbito limitado.

---

## 4. Validar o ciclo missão → job → resultado (ambiente de teste)

> ✅ **Desbloqueado:** o drift `status` × `state` foi corrigido na FASE 1
> (`76e3969`) — com a integração registada em `state='connected'` (§2), o
> passo 1 autentica de verdade.
>
> Fazer primeiro contra **localhost** ou um **preview deployment**; se usar o
> projeto Supabase de produção, usar uma org de teste. Não existe projeto de
> staging dedicado — **a confirmar** com ela (ver `docs/DEPLOY_PREP.md` §6).

```bash
BASE=http://localhost:3000            # ou o URL do preview
KEY=hub_live_<chave_entregue_no_passo_2>
ORG=<org_id_de_teste>

# --- 1) MISSÃO → JOB: a Athena cria um job (esperado: 201) ---
TS=$(date +%s); NONCE=$(cat /proc/sys/kernel/random/uuid)
JOB=$(curl -s -X POST $BASE/api/v1/jobs \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "X-Request-Timestamp: $TS" -H "X-Nonce: $NONCE" \
  -d '{"orgId":"'"$ORG"'","toolId":"vectorcraft",
       "idempotencyKey":"'"$NONCE"'",
       "params":{"prompt":"logo de teste","maxCostCents":1}}')
echo "$JOB" | head -c 500; echo
JOB_ID=$(echo "$JOB" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).job.id")

# --- 2) POLLING: a Athena lê o estado até terminal (esperado: PENDING_APPROVAL) ---
fresh() { # novo timestamp+nonce POR requisição (anti-replay!)
  curl -s "$BASE/api/v1/jobs/$JOB_ID?orgId=$ORG" \
    -H "Authorization: Bearer $KEY" \
    -H "X-Request-Timestamp: $(date +%s)" \
    -H "X-Nonce: $(cat /proc/sys/kernel/random/uuid)"
}
fresh | head -c 400; echo
# No MVP o job PARA em PENDING_APPROVAL com integrationStatus:"pending".
# Isto é o comportamento correto — não é bug, não é falha.

# --- 3) IDEMPOTÊNCIA: reenviar a criação com o MESMO idempotencyKey ---
# (nonce NOVO, idempotencyKey o mesmo do passo 1)
# Esperado: 200 + "deduplicated":true (não cria job duplicado).

# --- 4) ANTI-REPLAY: repetir uma requisição com o MESMO nonce ---
# Esperado: 401 {"error":{"code":"REPLAY_DETECTED",...}}.

# --- 5) APROVAÇÃO (humana, na UI ou via sessão owner/admin) ---
# UI → Aprovações → aprovar com justificativa → job vai a QUEUED.
# Via API só com scope approvals:decide (não concedido no MVP — ver §3).

# --- 6) RESULTADO: ler events e assets ---
# GET /api/v1/jobs/$JOB_ID/events?orgId=$ORG  → linha do tempo (200)
# GET /api/v1/jobs/$JOB_ID/assets?orgId=$ORG  → [] honesto no MVP (200)
```

**Checklist PASS do ciclo:**
- [ ] `201` na criação; `200` + `deduplicated:true` no reenvio idempotente
- [ ] `401 REPLAY_DETECTED` com nonce repetido; `401` com timestamp fora de ±5 min
- [ ] `403` com scope insuficiente ou `orgId` de outra org
- [ ] `429` com `Retry-After` sob polling agressivo (>120 req/60s)
- [ ] Job pára em `PENDING_APPROVAL` / `integrationStatus:"pending"` (MVP)
- [ ] Aprovação humana na UI move para `QUEUED` com registo em `audit_logs`
- [ ] `GET /health` continua `200` durante tudo (sem degradação)

---

## 5. Erros que vais ver (e o que significam)

| Código HTTP / `error.code` | Significado | Ação do operador |
|---|---|---|
| `401` sem código / auth ausente | Falta `Authorization: Bearer` | Configurar a chave no cliente |
| `401 REPLAY_DETECTED` | `X-Nonce` repetido | Bug no cliente: gerar uuid novo por requisição |
| `401` (timestamp) | `X-Request-Timestamp` fora de ±5 min | Sincronizar relógios (NTP) |
| `403 FORBIDDEN` | Scope insuficiente | Rever `integrations.config.scopes` |
| `403` (org) | `orgId` do pedido ≠ org da chave | Cliente a cruzar orgs — corrigir o mapeamento |
| `409 INVALID_TRANSITION` | Decidir job fora de `PENDING_APPROVAL` | Poll primeiro; só decidir pendentes |
| `429 RATE_LIMITED` | >120 req/60s | Espaçar polling; respeitar `Retry-After` |
| `409` idempotência (23505) | Corrida na criação | Cliente lê o job existente (fallback já no Hub) |

## 6. Limites operacionais da integração (saber de cor)

- **Sem webhooks no MVP** — a Athena faz **polling** de `GET /jobs/{id}`
  (respeitando o rate limit). Webhooks são upgrade futuro.
- **Rate limit e nonces são em memória** — com 1 instância (o caso atual) está
  bem; antes de escalar horizontalmente, migrar para Redis (interfaces já
  isoladas em `lib/rate-limit.ts` e `lib/api-keys.ts`).
- **Chave vinculada a UMA org** — a Athena guarda `orgId` por integração e
  nunca os cruza.
- **Aprovações exigem humano** — a Athena prepara/encaminha; quem decide é
  `owner`/`admin` na UI. (Paralelo com a regra da Athena: o Telegram nunca
  aprova sozinho.)
