# ATHENA Integration — contrato /api/v1

> Público: Cláudio (arquitetura multiagentes) e quem for implementar o lado
> cliente na ATHENA Control. Contrato formal: [`openapi.yaml`](../openapi.yaml).
>
> **Atualização 26/10/2026 (branch `feat/athena-connect-discovery`): ver a
> secção final "Atualização 26/10/2026 — entrega" — descoberta Athena,
> permissões fail-closed, estado honesto atual e correções de estado face
> a este documento (base pré-G2). O corpo abaixo mantém-se como contrato
> de base; onde houver divergência, vale a atualização datada.**

## Visão geral

O Tools Hub expõe uma API versionada em `/api/v1` para ser comandada pela
ATHENA Control. Dois modos de autenticação, avaliados nesta ordem:

1. **Machine-to-machine** — `Authorization: Bearer <api key>` por integração,
   com proteção anti-replay obrigatória.
2. **Sessão de usuário** — cookies de sessão do Supabase Auth.

Toda resposta de erro segue `{ error: { code, message, requestId } }`
e carrega o header `x-request-id` para correlação com logs.

## Rotas

| Método | Rota | Auth / scope | Descrição |
|---|---|---|---|
| GET | `/api/v1/health` | nenhum | `{status:'ok', version, supabase, timestamp}` |
| GET | `/api/v1/tools` | `tools:read` | Catálogo |
| GET | `/api/v1/tools/{id}` | `tools:read` | Detalhe + `integrationStatus` |
| GET | `/api/v1/jobs?orgId=&status=&toolId=` | `jobs:read` | Lista paginada |
| POST | `/api/v1/jobs` | `jobs:write` | Cria job (idempotente) |
| GET | `/api/v1/jobs/{id}?orgId=` | `jobs:read` | Detalhe do job |
| GET | `/api/v1/jobs/{id}/events?orgId=` | `jobs:read` | Linha do tempo |
| GET | `/api/v1/jobs/{id}/assets?orgId=` | `jobs:read` | Assets produzidos |
| POST | `/api/v1/jobs/{id}/cancel` | `jobs:write` | Cancela (não-terminal) |
| GET | `/api/v1/approvals?orgId=` | `approvals:decide` | Fila de aprovação |
| POST | `/api/v1/approvals/{id}/decision` | `approvals:decide` | Aprova/rejeita |

Gating de UI: `proxy.ts` redireciona `/app/*` sem sessão para `/login`
quando o Supabase está configurado; sem Supabase, libera tudo com o header
`x-hub-setup: pending` (estado honesto de setup).

## Autenticação machine-to-machine

### Emissão de chaves

**Caminho atual (FASE 2D, C5) — por endpoint, depois da migration 0011:**

`POST /api/v1/integrations/{integrationId}/api-keys` com **sessão humana
owner/admin** da org (chaves de API recebem 403 — credenciais não gerem
credenciais). Corpo: `{ label, scopes?, expiresInDays?, withSigningSecret?,
replacesKeyId? }`. A resposta (201) traz a chave crua e o segredo de
assinatura **uma única vez**; a BD guarda só o hash (tabela `api_keys`) e
a referência do segredo. Expiração por omissão: **90 dias**. Revogação:
`DELETE /api/v1/integrations/{integrationId}/api-keys/{keyId}` (imediata,
idempotente). Listagem de metadados (nunca o hash): `GET` na mesma rota.
Rotação: emitir com `replacesKeyId` e revogar a antiga.

⚠️ **Estado:** a migration `0011_api_keys.sql` está **preparada, não
aplicada** (gate G2). Sem ela, estes endpoints devolvem `501` honesto e
vale o processo legado abaixo. Plano completo:
`docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md`.

**Pré-condição — o registo da integração:** a emissão é por integração
(o `{integrationId}` da rota) e a org resolve-se a partir dessa linha.
A BD do Hub tem hoje **zero** linhas em `integrations` (auditoria de
2026-10-23): o registo inicial da Athena é um passo manual documentado
no plano (gate **G2.5**, entre aplicar a 0011 e o smoke de validação),
executado pela Cristiane no SQL editor — **ainda não foi criado**.

**Processo legado (transição — mundo pré-0011 e fallback):**

1. Gerar o par com `generateApiKey()` de `lib/api-keys.ts`:
   `hub_live_<64 hex>` (crua) + SHA-256 (hash).
2. Gravar **apenas o hash** em `integrations.config.apiKeyHash` e os scopes em
   `integrations.config.scopes`, com `state='connected'` (coluna real da
   migration 0001 — `verifyApiKey` só aceita esse estado) e o `org_id` da org.
3. Entregar a chave crua **uma única vez** ao dono da integração, fora do git,
   fora do chat (arquivo para download / vault).

A chave crua nunca persiste em banco, logs ou código.

### Verificação (lado Hub)

`verifyApiKey(rawKey)` → `{ orgId, scopes, integrationId, … } | null`,
em dois caminhos (FASE 2D):

1. **Tabela `api_keys`** (pós-0011): lookup O(1) por hash indexado.
   Revogada ou expirada = `null` **decisivo** (o legado não ressuscita a
   chave). A identidade inclui `apiKeyId` e `signingSecretRef`.
2. **Legado** (fallback, `HUB_API_KEYS_LEGACY_FALLBACK`): o hash é
   comparado em tempo constante contra as integrações com
   `state='connected'` — as únicas que a query lê. Só se chega aqui
   sem linha na tabela nova ou com a tabela **comprovadamente
   inexistente** (pré-0011).

Chave inválida, revogada, expirada ou ausente devolve `null` → 401
indistinguível. **Falha de infraestrutura não é 401** (REVISÃO PRÉ-G2):
se a leitura da tabela `api_keys` falhar por conexão, permissão,
timeout, erro genérico ou exceção do cliente — qualquer erro que não
prove a tabela inexistente — a verificação lança `500` (fail-closed)
e o caminho legado **não** é tentado. Um erro de BD nunca rebaixa a
autenticação em silêncio. A mesma classificação governa o registo do
nonce: só a tabela de nonces comprovadamente inexistente degrada para
memória (declarado); o resto é 500. Tabela de decisão completa:
`docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md` §2.1.

### Anti-replay (obrigatório para API keys)

Headers por requisição:

```
X-Request-Timestamp: 1792345678   # unix seconds, tolerância ±5 min
X-Nonce: 3f9a2c1e-...             # uuid único por requisição
```

Nonces repetidos por chave → `401 REPLAY_DETECTED`. Timestamps fora da
janela → `401`. Para chaves da tabela `api_keys`, o nonce é registado
**na base de dados antes de processar** (insert-first, atómico entre
instâncias — tabela `api_request_nonces`); para chaves legadas, o
rastreio continua em memória com TTL de 10 min (por instância). Se a
0011 ainda não estiver aplicada, as chaves da tabela comportam-se como
legadas neste ponto — degradação declarada, nunca fingida.

### Assinatura HMAC (FASE 2D, C3 — Opção A)

Chaves da tabela `api_keys` emitidas com segredo de assinatura devem
assinar cada pedido:

```
X-Signature: <hex minúsculo de HMAC-SHA256(segredo, string canónica)>
X-Key-Id: <id da chave>            # opcional; se vier, tem de ser a chave apresentada
```

String canónica: `METHOD\nPATH+QUERY(ordenada por chave)\n
X-Request-Timestamp\nX-Nonce\nSHA256_HEX(corpo)` — definição completa e
vetor de teste em `docs/FASE2C_C3_C5_SPEC.md` §2. O segredo
(`hub_sign_…`) é **dedicado** e vive nos cofres dos dois lados; o Hub
guarda só a referência (= id da chave) e resolve o valor em
`HUB_SIGNING_SECRETS_JSON`. Rollout: a assinatura é opcional mas, quando
apresentada, é sempre validada (inválida → 401 genérico); torna-se
obrigatória com `HUB_REQUIRE_SIGNATURES=true` (gate G4, quando a Athena
já assinar tudo).

### Scopes

`tools:read` · `jobs:read` · `jobs:write` · `approvals:decide`.
Scope insuficiente → `403 FORBIDDEN`. Chave vinculada a **uma** org:
`orgId` divergente no request → `403`.

### Rate limit

120 req / 60s por identidade (hash da chave ou IP). Headers
`X-RateLimit-Limit/Remaining/Reset`; em 429, `Retry-After`.

## Formato de job

```json
{
  "job": {
    "id": "3f9a2c1e-5b4d-4a8f-9c2e-7d1b3f5a9c0e",
    "orgId": "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a",
    "toolId": "vectorcraft",
    "status": "PENDING_APPROVAL",
    "params": { "prompt": "logo minimalista de cafeteria", "width": 1024 },
    "idempotencyKey": "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e",
    "createdBy": "integration-id-ou-user-id",
    "createdAt": "2026-10-16T10:30:00.000Z",
    "updatedAt": "2026-10-16T10:30:01.000Z",
    "errorMessage": null,
    "result": null,
    "integrationStatus": "pending"
  },
  "deduplicated": false
}
```

**Estados** (máquina em `lib/jobs/machine.ts`):

```
CREATED → VALIDATING → PENDING_APPROVAL → QUEUED → RUNNING → COMPLETED
                        ↘ (VALIDATING pode ir direto a QUEUED quando o
                           contrato não exige aprovação)
CANCELLED a partir de qualquer estado não-terminal.
FAILED a partir de VALIDATING / QUEUED / RUNNING.
```

`integrationStatus: 'pending'` = honesto: nenhum executor real conectado;
o job **não** executa e nada é simulado. `'ready'` só quando
`adapter.executionReady === true`.

## Criação idempotente

`POST /api/v1/jobs` com `idempotencyKey` (UUID) no body **ou** header
`Idempotency-Key`. Reenvio com a mesma chave + mesma org retorna o job
original: `200` + `deduplicated: true` (primeira vez: `201`).
Escopo da chave: `(org_id, idempotency_key)` — UNIQUE no banco, com
fallback de leitura em caso de corrida (erro 23505).

## Eventos e assets

`GET /jobs/{id}/events` — linha do tempo ordenada (`status_transition`,
`job_created`, …) com `fromStatus/toStatus`, `payload` e ator
(`user` | `api_key`).

`GET /jobs/{id}/assets` — `[{id, kind, url, metadata, createdAt}]`.
Vazio honesto enquanto nada foi produzido.

## Aprovações

`GET /api/v1/approvals?orgId=` lista `PENDING_APPROVAL` (paginado).

`POST /api/v1/approvals/{id}/decision`:

```json
{ "orgId": "0e2b12d4-…", "decision": "approve", "justification": "Briefing confere com o roteiro." }
```

`approve` → `QUEUED` · `reject` → `CANCELLED`. `justification` obrigatória
(1–2000 chars). Sessão de usuário exige papel `owner`/`admin`; o aprovador
fica registrado em `audit_logs` (`approval.granted` / `approval.rejected`).
Decidir job fora de `PENDING_APPROVAL` → `409 INVALID_TRANSITION`.

> **Quem decide (FASE 2B, C4):** a decisão é EXCLUSIVAMENTE humana,
> garantido em código — chaves de API são recusadas com 403 neste
> endpoint MESMO com o scope `approvals:decide` (`requireHumanSession`
> em `lib/api-auth.ts`). O scope continua válido para LER a fila
> (`GET /api/v1/approvals`).

> **Estado real de `approval_requests` e da expiração (FASE 2B, C9):**
> a tabela `approval_requests` existe no schema (migration 0001, com
> coluna `expires_at`), mas **nenhum código a lê ou escreve** — está
> reservada, não implementada. As aprovações vivem no ESTADO DO JOB
> (`execution_jobs`: `PENDING_APPROVAL → QUEUED/CANCELLED`), decididas
> por `decideApproval` (`lib/jobs/service.ts`). Consequência honesta:
> **a expiração NÃO é aplicada** — um job em `PENDING_APPROVAL` não
> expira sozinho ao fim de nenhum prazo; fica pendente até um humano
> decidir ou o job ser cancelado. Não assumir TTL de aprovações em
> lado nenhum (nem Athena, nem UI).

## Auditoria

Toda transição de estado gera linha em `execution_events`; toda ação
relevante (create, transition, cancel, decision) gera linha em `audit_logs`
com `actor_id`/`actor_type`. Nada é apagado pelo fluxo normal.

## PENDÊNCIAS PARA CLÁUDIO (arquitetura multiagentes)

Pontos de ligação que a ATHENA Control precisa implementar do lado cliente:

1. **Emissão e rotação de chaves** — o Hub só verifica; a Control precisa de
   UX/fluxo para gerar (`generateApiKey`), entregar uma única vez e revogar
   (passar `integrations.state` para um estado ≠ `'connected'`, p. ex.
   `'unavailable'`) chaves por integração.
2. **Assinatura anti-replay** — o cliente Athena deve enviar
   `X-Request-Timestamp` + `X-Nonce` únicos por requisição (janela ±5 min);
   relógios dessincronizados causam `401`.
3. **Idempotency-Key** — gerar um UUID por intenção de job e reutilizar em
   retries; nunca reutilizar entre jobs diferentes.
4. **Polling de jobs** — não há webhook no MVP; a Control deve poll
   `GET /jobs/{id}` (respeitando rate limit) até estado terminal.
   Webhooks de conclusão são o upgrade natural (fora do escopo MVP).
5. **Fila de aprovações** — surface para humanos aprovarem/rejeitarem com
   justificativa; `approvals:decide` não deve ser concedido a agentes
   autônomos sem supervisão.
6. **Mapeamento tool → executor** — `integrationStatus: 'pending'` significa
   "contrato pronto, executor ausente"; a Control não deve tratar como falha
   nem simular resultado.
7. **Multi-instância** — rate limit e nonces anti-replay são em memória;
   antes de escalar horizontalmente, migrar ambos para Redis
   (interfaces isoladas em `lib/rate-limit.ts` e `lib/api-keys.ts`).
8. **RBAC** — papéis `owner/admin/member/viewer` em `organization_members`;
   decisões de aprovação exigem `owner`/`admin` para usuários humanos.
9. **Verificação de org** — a chave é vinculada a uma org; a Control deve
   guardar `orgId` por integração e nunca cruzá-los.

---

## Atualização 26/10/2026 — entrega (`feat/athena-connect-discovery`)

**Distinção que vale em toda esta secção: CÓDIGO PRONTO vs CONECTADO vs
PUBLICADO vs EXECUÇÃO REAL COMPROVADA.** Hoje: código pronto (descoberta
+ permissões fail-closed), nada conectado de ponta a ponta a partir
desta branch, nada publicado a partir desta branch, **zero execução real
comprovada**. Nada neste documento afirma que a ATHENA já consome o Hub.

### Correções de estado face ao corpo acima (base pré-G2)

- A migration `0011_api_keys.sql` já não está "preparada, não aplicada":
  **segundo atualização da Cristiane de 24/10, o G2 foi concluído com a
  0011 aplicada** no Supabase oficial (por ela via ChatGPT). Os
  endpoints de chaves já não devolvem 501 por esse motivo.
- O registo inicial da Athena (G2.5) já não está "por criar": **segundo
  confirmação da Cristiane de 25/10**, org "Ofensiva Criativa" e
  integração `provider: athena`, `state: connected` foram registadas.
  **Verificação independente por agentes NÃO feita** (service_role
  nunca fornecida): o lado ATHENA deve tratar o registo como a
  confirmar no primeiro smoke autenticado (G3 T1), não como provado.
- Nonces anti-replay para chaves da tabela `api_keys` são persistidos em
  BD (insert-first, atómico entre instâncias); só as chaves legadas
  mantêm rastreio em memória (TTL 10 min).

### Novo: descoberta para a ATHENA — `GET /api/v1/athena/tools`

- Auth: Bearer, scope `tools:read`. **Não exige Supabase configurado**:
  descreve contratos, não linhas por org.
- Por tool: `id, name, description, capabilities, catalogState,
  integrationStatus, executionReady, requiresApproval, estimatedCost,
  inputs, source, agentPermission`.
- `integrationStatus`: `"ready"` só com executor real conectado — **hoje
  sempre `"pending"`**. Resumo honesto: `execution: { ready: 0, pending:
  N, total: N }` — hoje `ready: 0`.
- Chamador m2m: `caller.canDecideApprovals: false`. Permissões por
  agente: `agentPermissions: { linked: false, note: … }` e
  `agentPermission: null` por tool enquanto não houver vínculo
  resolvido. **Nenhuma permissão é inventada.**
- Catálogo hoje: 12 tools, 4 adapters (`vectorcraft`, `hyperframes`,
  `apify-mcp`, `mkvideos`), **0 prontas** (`executionReady = false` em
  todos). Jobs sem executor real ficam `QUEUED` ou `PENDING_APPROVAL` e
  nunca completam. O adapter `mkvideos` lança 501 no Hub: o executor
  real vive na ATHENA (Fase 7, Cláudio). **Não existe adapter nem
  entrada de catálogo "scalaflow" neste repo.**
- Também novo: `GET /api/v1/tools/{id}` sem BD responde 200 com o
  contrato em código (fallback antes inalcançável) ou 404 estruturado.

### Novo: missões Athena (contrato já existente, agora documentado aqui)

- `POST /api/v1/athena/missions` (scope `jobs:write`) e `GET
  /api/v1/athena/missions/{id}` (scope `jobs:read`, **polling** — a
  entrega de webhooks/callbacks NÃO está implementada).
- **Idempotência**: `mission_id` (ATHENA) = `idempotency_key` do job por
  org. Primeira vez → **201**; reenvio do mesmo `mission_id` → **200 +
  `deduplicated: true`**.
- Mapeamento Hub↔ATHENA (total, sem aproximações): `COMPLETED →
  SUCCEEDED`, `PENDING_APPROVAL → AWAITING_APPROVAL`; estado desconhecido
  = exceção. Divergência de aprovação → **409 CONFLICT**.
- Estados de job: `CREATED → VALIDATING → PENDING_APPROVAL / QUEUED →
  RUNNING → COMPLETED / FAILED / CANCELLED`.

### Permissões — o que está garantido e o que falta

- Chave futura da ATHENA: só `tools:read + jobs:read + jobs:write`,
  **nunca** `approvals:decide` efetivo (`requireHumanSession` recusa
  qualquer contexto m2m na decisão, mesmo com o scope concedido).
- A tabela `agent_tool_permissions` existe (migration 0008) e a
  primitiva pura fail-closed existe (`lib/athena/agent-permissions.ts`),
  mas **NÃO está ligada à intake de missões** — bloqueio de schema
  documentado em `docs/ATHENA_AGENT_TOOL_SCHEMA_DECISION.md`. Até à
  decisão, as missões autorizam só por scope da chave.
- **⚠️ `HUB_SIGNING_SECRETS_JSON` NÃO EXISTE no servidor (T4
  pendente).** Sem ela, uma assinatura HMAC apresentada não valida
  (→ 401). Bloqueador do G3 ponta a ponta; ação de quem gere o deploy +
  redeploy. Nenhuma credencial é criada nesta etapa (Fase 11).

### O que NÃO existe (lista honesta, 26/10/2026)

- Nenhum executor real ligado a nenhuma tool.
- Nenhum botão "Conectar ferramenta": "Configurar" não grava nada,
  "Testar conexão" está desativado, não existe API de configuração/teste
  de integrações. A "conexão" real é programática: emissão de chave.
- Nenhum vínculo agente↔integração no schema (decisão pendente).
- Nenhuma entrega de webhooks. Nenhuma entrada "scalaflow" no catálogo.

### O que falta para pelo menos UMA ferramenta executável (por ordem)

1. Decisão de schema agente↔integração (Cristiane, ou conjunta com o
   Cláudio) — ver `docs/ATHENA_AGENT_TOOL_SCHEMA_DECISION.md`.
2. Executor real ligado a ≥1 tool. Candidata: VectorCraft (viabilidade a
   confirmar; HyperFrames é motor de composição, não executor do Hub).
3. T4: `HUB_SIGNING_SECRETS_JSON` no servidor + redeploy.
4. Login definitivo do Hub: callback do alias na allowlist do Supabase
   + UM link novo clicado de imediato (sessão da Cristiane).
5. Emissão da chave da ATHENA (só após 1–4) + G3 ponta a ponta (T1–T6).
6. Lado ATHENA/Cláudio: merges (`feat/athena-control`,
   `feat/athena-blog-team`, `feat/athena-mkvideos-integration`), deploy
   do Control, correção da semântica do `verify` (hoje: health pública
   dá "Conectado" — um GET 2xx/3xx não prova dados nem execução),
   confirmação das linhas do Connect no banco da VPS (a contagem "7 vs
   6" não fecha a partir deste repo).
7. Fase 11 para qualquer credencial real, missão real ou gasto.

### Testes desta entrega (o que provam e o que NÃO provam)

- Suite: **592/592 (53 ficheiros)**, `typecheck` e `lint` limpos —
  números re-corridos nesta etapa, não herdados.
- O teste ATHENA → ScalaFlow é **mock dos dois lados** (chamador mock +
  ferramenta mock com stats em fixture): prova o contrato (HTTP,
  autenticação, execução funcional, idempotência, negativos), **não
  prova integração real com ScalaFlow nem ATHENA real**, nem
  comportamento em produção, nem HMAC com segredo real (T4 pendente).
