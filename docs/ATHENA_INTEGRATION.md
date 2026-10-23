# ATHENA Integration — contrato /api/v1

> Público: Cláudio (arquitetura multiagentes) e quem for implementar o lado
> cliente na ATHENA Control. Contrato formal: [`openapi.yaml`](../openapi.yaml).

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

### Emissão de chaves (fora do MVP — processo manual documentado)

1. Gerar o par com `generateApiKey()` de `lib/api-keys.ts`:
   `hub_live_<64 hex>` (crua) + SHA-256 (hash).
2. Gravar **apenas o hash** em `integrations.config.apiKeyHash` e os scopes em
   `integrations.config.scopes`, com `state='connected'` (coluna real da
   migration 0001 — `verifyApiKey` só aceita esse estado) e o `org_id` da org.
3. Entregar a chave crua **uma única vez** ao dono da integração, fora do git,
   fora do chat (arquivo para download / vault).

A chave crua nunca persiste em banco, logs ou código.

### Verificação (lado Hub)

`verifyApiKey(rawKey)` → `{ orgId, scopes, integrationId } | null`.
O hash é comparado em tempo constante contra as integrações com
`state='connected'` — as únicas que a query lê; qualquer outro estado
(ou chave desconhecida) devolve `null` → 401 indistinguível.
Upgrade documentado: tabela dedicada `api_keys(key_hash PK, …)` com índice.

### Anti-replay (obrigatório para API keys)

Headers por requisição:

```
X-Request-Timestamp: 1792345678   # unix seconds, tolerância ±5 min
X-Nonce: 3f9a2c1e-...             # uuid único por requisição
```

Nonces repetidos por chave → `401 REPLAY_DETECTED`. Timestamps fora da
janela → `401`. O rastreio é em memória com TTL de 10 min
(ver `lib/api-keys.ts`); em multi-instância, migrar para Redis
(mesma semântica: SETNX com TTL).

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
