# ATHENA ↔ Tools Hub — a ponte (FASE 8)

> Lado Hub implementado nesta fase. Contrato formal: [`ATHENA_INTEGRATION.md`](./ATHENA_INTEGRATION.md) + [`openapi.yaml`](../openapi.yaml).
> A secção **HANDOFF PARA O CLÁUDIO** no fim é escrita para quem vai implementar o lado Athena.

## O que a ponte faz

A ATHENA Control fala em **missões**; o Hub fala em **jobs**. A ponte traduz:

| Athena | Hub | Onde |
|---|---|---|
| `POST /api/v1/athena/missions` | `createJob` (idempotente) | `app/api/v1/athena/missions/route.ts` |
| `GET /api/v1/athena/missions/{mission_id}` | `findJobByMissionId` + `getJob` | `app/api/v1/athena/missions/[id]/route.ts` |
| `MissionStatus` (vocabulário Athena) | `JobStatus` (máquina do Hub) | `lib/athena/adapter.ts` |
| envelope da missão (validação zod) | — | `lib/athena/contract.ts` |
| callback de resultado (estrutura) | polling (caminho real) | `lib/athena/callback.ts` |
| correlação missão↔job | `mission_id` = `idempotencyKey` | `lib/athena/missions.ts` |

**Ficheiros desta fase (todos novos; nenhuma rota existente foi tocada):**

- `lib/athena/contract.ts` — schema zod da missão, `MissionStatus`, `resolveRequiresApproval`, `missionToJobInput`.
- `lib/athena/adapter.ts` — mapeamento total e bijetivo Hub↔Athena + divergências documentadas.
- `lib/athena/callback.ts` — estrutura do callback, `buildCallbackPayload`, `deliverCallback` (501 explícito no MVP).
- `lib/athena/missions.ts` — `findJobByMissionId`, `buildMissionResponse`, `resolveMissionApproval`.
- `app/api/v1/athena/missions/route.ts` — POST (scope `jobs:write`).
- `app/api/v1/athena/missions/[id]/route.ts` — GET (scope `jobs:read`).
- `examples/athena-mission.json` — payload válido de exemplo.

## O envelope da missão

`POST /api/v1/athena/missions` — corpo:

```json
{
  "mission_id": "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e",
  "tool_id": "vectorcraft",
  "org_id": "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a",
  "params": { "prompt": "logo minimalista de cafeteria", "width": 1024 },
  "requires_human_approval": true,
  "callback": { "url": "https://athena.exemplo.com/hooks/hub-mission" },
  "priority": 80,
  "tags": ["ofensiva-criativa"],
  "expires_at": "2030-01-01T00:00:00.000Z"
}
```

Campos obrigatórios: `mission_id` (UUID), `tool_id`, `params` (objeto).
Opcionais: `org_id` (deve ser a org da chave), `requires_human_approval`
(boolean; omitido = decide o contrato da tool), `callback` (só HTTPS),
`priority` (0–100, default 50), `tags` (máx. 10), `expires_at` (ISO 8601 futuro).

Resposta `201` (criada) ou `200` + `deduplicated: true` (reenvio do mesmo `mission_id`):

```json
{
  "mission": {
    "mission_id": "9c2e7d1b-…",
    "job_id": "3f9a2c1e-…",
    "org_id": "0e2b12d4-…",
    "status": "AWAITING_APPROVAL",
    "hub_status": "PENDING_APPROVAL",
    "requires_human_approval": true,
    "awaiting_approval": true,
    "approval": {
      "approval_id": "3f9a2c1e-…",
      "decision_endpoint": "/api/v1/approvals/3f9a2c1e-…/decision",
      "note": "Decisão humana via sistema de approvals existente (approve → QUEUED, reject → CANCELLED)."
    },
    "result": null,
    "error_message": null,
    "assets": null,
    "integration_status": "pending",
    "callback": { "accepted": true, "delivery": "not-implemented" },
    "created_at": "…",
    "updated_at": "…"
  },
  "deduplicated": false
}
```

## Mapeamento de estados

Tradução total e bijetiva (`lib/athena/adapter.ts` — estado desconhecido = exceção, nunca aproximação):

| Hub (`hub_status`) | Athena (`status`) |
|---|---|
| `CREATED` | `RECEIVED` |
| `VALIDATING` | `VALIDATING` |
| `PENDING_APPROVAL` | `AWAITING_APPROVAL` |
| `QUEUED` | `QUEUED` |
| `RUNNING` | `RUNNING` |
| `COMPLETED` | `SUCCEEDED` |
| `FAILED` | `FAILED` |
| `CANCELLED` | `CANCELLED` |

Terminais: `SUCCEEDED`, `FAILED`, `CANCELLED`. `SUCCEEDED` só existe com resultado real — o Hub **nunca** simula sucesso; sem executor conectado (`integration_status: "pending"`), a missão fica em estado honesto.

## Aprovações humanas

Quando a missão exige aprovação (`requires_human_approval: true` ou contrato da tool), o job entra em `PENDING_APPROVAL` e a resposta traz o `decision_endpoint` do **sistema de approvals existente**:

```
POST /api/v1/approvals/{approval_id}/decision
{ "orgId": "…", "decision": "approve" | "reject", "justification": "…" }
```

`approve` → `QUEUED` · `reject` → `CANCELLED`. Decisão fora de `PENDING_APPROVAL` → `409`. O aprovador fica em `audit_logs`. Nota: `approvals:decide` não deve ser concedido a agentes autónomos sem supervisão.

## Resultado: polling (callbacks ainda não)

`GET /api/v1/athena/missions/{mission_id}` retorna o envelope acima; em `SUCCEEDED`, `result` e `assets` vêm preenchidos (vazio honesto enquanto nada existir). **Não há webhooks no MVP**: `callback.url` é aceite e validado (contrato estável para o futuro), mas a entrega lança `501 NOT_IMPLEMENTED` de forma explícita — a resposta assinala `"delivery": "not-implemented"`. Política de entrega futura (tentativas, backoff, HMAC) documentada em `lib/athena/callback.ts`.

## Erros

Todos seguem `{ error: { code, message, requestId } }` + header `x-request-id`:

| Situação | HTTP | `code` |
|---|---|---|
| Sem auth / chave inválida / anti-replay em falta | 401 | `UNAUTHORIZED` |
| Nonce repetido | 401 | `REPLAY_DETECTED` |
| Timestamp fora de ±5 min | 401 | `UNAUTHORIZED` |
| Scope insuficiente / org divergente | 403 | `FORBIDDEN` |
| Payload inválido | 400 | `VALIDATION` |
| `requires_human_approval` diverge do contrato da tool | 409 | `CONFLICT` |
| Missão inexistente | 404 | `NOT_FOUND` |
| Rate limit (120 req/60s) | 429 | `RATE_LIMITED` |
| Supabase não configurado | 503 | `SUPABASE_NOT_CONFIGURED` |

---

# HANDOFF PARA O CLÁUDIO

_Olá Cláudio — esta secção é para ti. O lado Hub da ponte está pronto; aqui está exatamente o que precisas de implementar na ATHENA Control._

## 1. O que já existe do lado Hub (não precisas de reimplementar)

- `POST /api/v1/athena/missions` — recebe a missão, cria o job idempotente, devolve a correlação missão↔job.
- `GET /api/v1/athena/missions/{mission_id}` — estado sincronizado, resultado e assets quando terminais.
- Aprovações: sistema existente em `POST /api/v1/approvals/{id}/decision` (humano com justificativa).
- Tudo autenticado por API key + anti-replay; erros padronizados com `x-request-id`.

## 2. Autenticação (passo a passo)

1. Pede à Cristiane a emissão de uma API key para a integração Athena (processo manual documentado em `ATHENA_INTEGRATION.md` — ela entrega-te a chave crua **uma vez**; guarda-a no vault, nunca no git/chat). A chave vem com os scopes `jobs:read`, `jobs:write` (+ `approvals:decide` **só** se um humano for decidir via Athena; nunca para agentes autónomos).
2. Em **cada** requisição envia os 3 headers:
   ```
   Authorization: Bearer hub_live_<…>
   X-Request-Timestamp: <unix seconds, ex.: 1792345678>   # relógio sincronizado (NTP); tolerância ±5 min
   X-Nonce: <uuid v4 novo em cada requisição>              # nunca reutilizar — reutilizar dá 401 REPLAY_DETECTED
   ```
3. Guarda o `orgId` devolvido no registo da integração e usa-o em `org_id` — nunca cruzes orgs.

## 3. Enviar uma missão (exemplo completo)

```bash
curl -X POST http://localhost:3000/api/v1/athena/missions \
  -H "Authorization: Bearer $HUB_API_KEY" \
  -H "X-Request-Timestamp: $(date +%s)" \
  -H "X-Nonce: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "mission_id": "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e",
    "tool_id": "vectorcraft",
    "org_id": "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a",
    "params": { "prompt": "logo minimalista de cafeteria", "width": 1024 },
    "requires_human_approval": true
  }'
```

Regras que tens de respeitar no teu cliente:

- **`mission_id` é o teu id de idempotência**: gera um UUID v4 por missão e **reutiliza-o em retries**. Reenviar o mesmo `mission_id` devolve o mesmo job (`200` + `deduplicated: true`). Nunca reutilizes um `mission_id` para uma missão diferente.
- **`tool_id`** é o slug do catálogo (`GET /api/v1/tools`). `params` são validados contra o contrato da tool — params inválidos dão `400 VALIDATION` com detalhe.
- **`requires_human_approval`**: se enviares `true`/`false`, tem de **concordar com o contrato da tool** no Hub (hoje, todas as tools exigem aprovação). Divergência → `409 CONFLICT` com mensagem explícita. Se omitires, o Hub decide pelo contrato da tool. Não há ajuste silencioso — trata o 409 como erro de programação do teu lado, não como retry.
- **`callback.url`** (opcional, HTTPS): é aceite e validado, mas a entrega **não está implementada** — a resposta diz `"delivery": "not-implemented"`. Não implementes lógica que dependa do webhook chegar; ele é contrato futuro.

## 4. Polling de estado (o caminho real para resultados)

Não há webhooks no MVP. Faz polling de:

```
GET /api/v1/athena/missions/{mission_id}?orgId=<orgId>
```

com os mesmos 3 headers de auth. Lê o campo `status` (**vocabulário Athena**, não o do Hub):

| `status` | Significado | O que fazer |
|---|---|---|
| `RECEIVED` / `VALIDATING` | a missão entrou, a validar | continuar polling |
| `AWAITING_APPROVAL` | à espera de humano | mostrar na fila de aprovações; humanos decidem em `POST /api/v1/approvals/{approval_id}/decision` |
| `QUEUED` / `RUNNING` | em curso | continuar polling |
| `SUCCEEDED` | terminou | ler `result` + `assets[]` (`{id, kind, url, metadata}`) |
| `FAILED` | falhou | ler `error_message`; não retry automático sem causa nova |
| `CANCELLED` | cancelado/rejeitado | terminal; não poll mais |

Sugestão de cadência: 5s nos primeiros 2 min, depois 15–30s; pára nos terminais. Respeita o rate limit (120 req/60s por chave; em `429`, lê `Retry-After`). O campo `hub_status` vai junto para debug — usa `status` para a lógica.

## 5. Aprovações (fluxo humano)

1. A Athena deteta `status: "AWAITING_APPROVAL"` no polling.
2. Mostra a missão a um humano com contexto (tool, params, `integration_status`).
3. O humano decide via `POST /api/v1/approvals/{approval_id}/decision` com `{ orgId, decision: "approve"|"reject", justification: "…" }` (justificativa obrigatória, 1–2000 chars). Para sessão de utilizador, o decisor precisa de papel `owner`/`admin`.
4. A Athena retoma o polling: `approve` → `QUEUED`; `reject` → `CANCELLED`.

Nota de honestidade: `integration_status: "pending"` significa "contrato pronto, executor ausente" — **não** é falha e **não** deves simular resultado do teu lado.

## 6. Tratamento de erros (tabela de decisão)

| Erro | Ação do cliente Athena |
|---|---|
| `401 UNAUTHORIZED` (sem headers anti-replay / timestamp fora da janela) | corrigir headers / sincronizar relógio (NTP); **não** retry cego |
| `401 REPLAY_DETECTED` | gerar novo `X-Nonce` (o anterior foi consumido) |
| `403 FORBIDDEN` | scope em falta ou `org_id` errado — erro de configuração, não retry |
| `400 VALIDATION` | logar `error.detail`, corrigir o payload; `mission_id` pode ser reutilizado após correção |
| `409 CONFLICT` (aprovação) | alinhar `requires_human_approval` com o contrato da tool |
| `404 NOT_FOUND` no GET | a missão nunca chegou ao Hub (ou org errada) — verificar antes de recriar |
| `429 RATE_LIMITED` | respeitar `Retry-After` e abrandar o polling |
| `503 SUPABASE_NOT_CONFIGURED` | Hub sem banco — degradar com honestidade, alertar operador |
| `5xx` outros | retry com backoff exponencial, **reutilizando o mesmo `mission_id`** |

Em todos os erros, regista o `x-request-id` da resposta — é a chave de correlação com os logs do Hub.

## 7. Checklist de aceitação (para validares a tua implementação)

- [ ] POST com `mission_id` novo → `201`, `deduplicated: false`, `status` inicial coerente.
- [ ] Reenvio do mesmo `mission_id` → `200`, `deduplicated: true`, **mesmo** `job_id`.
- [ ] `requires_human_approval` divergente do contrato → `409 CONFLICT` (não silencioso).
- [ ] Polling até `AWAITING_APPROVAL` → decisão humana → `QUEUED`; `reject` → `CANCELLED`.
- [ ] `SUCCEEDED` expõe `result` e `assets`; `FAILED` expõe `error_message`.
- [ ] Nonce reutilizado → `401 REPLAY_DETECTED`; timestamp velho → `401`.
- [ ] `callback.url` aceite com `"delivery": "not-implemented"` (sem assumir entrega).

## 8. O que NÃO fazer

- Não inventar `mission_id`s repetidos entre missões diferentes.
- Não tratar `integration_status: "pending"` como erro nem simular resultados.
- Não conceder `approvals:decide` a agentes autónomos.
- Não guardar a API key em código, chat ou logs — só no vault, e o `orgId` junto.
- Não implementar webhook receiver como caminho principal (é contrato futuro).
