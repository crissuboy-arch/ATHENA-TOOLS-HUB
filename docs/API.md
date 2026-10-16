# API interna — guia para o frontend

> Público: quem for construir as telas do Hub (catálogo, tarefas, aprovações,
> histórico). O contrato machine-to-machine (Athena) está em
> [`ATHENA_INTEGRATION.md`](./ATHENA_INTEGRATION.md) e
> [`openapi.yaml`](../openapi.yaml).

## Como chamar a API do browser

As rotas `/api/v1/*` aceitam a **sessão do usuário** (cookies do Supabase
Auth) — o frontend não precisa de API key. O `proxy.ts` já garante que
`/app/*` só abre com sessão (redireciona para `/login` caso contrário).

Todas as rotas de jobs/aprovações exigem `orgId`:

- `GET`: query string (`?orgId=...`)
- `POST`: campo `orgId` no body

A org ativa deve vir do contexto do usuário (`getUserOrganizations()` em
`lib/auth.ts` retorna `[{orgId, role, orgName}]`).

## Erros

```ts
// { error: { code, message, requestId } }
const res = await fetch(`/api/v1/jobs?orgId=${orgId}`);
if (!res.ok) {
  const { error } = await res.json();
  // error.code: 'FORBIDDEN' | 'VALIDATION' | ...
  // error.requestId → header 'x-request-id', útil p/ debug
}
```

Sem Supabase configurado, rotas de dados retornam `503`
(`SUPABASE_NOT_CONFIGURED`) — a UI deve mostrar estado de setup, não quebrar.

## Fluxos de tela

### Catálogo → criar tarefa

1. `GET /api/v1/tools` → cards. Use `integrationStatus`:
   `pending` = "em breve / executor em desenvolvimento" (nunca prometer execução).
2. `dryRun.requiresApproval` (em `/tools/{id}`) avisa que o job vai parar
   na fila de aprovação.
3. `POST /api/v1/jobs` com `{ orgId, toolId, params, idempotencyKey: crypto.randomUUID() }`.
   - `201` = criado · `200` + `deduplicated: true` = reenvio (não duplicar na UI).

### Acompanhar execução

- `GET /api/v1/jobs?orgId=&status=` com `page/perPage` (máx. 100).
- `GET /api/v1/jobs/{id}?orgId=` → `status` + `integrationStatus`.
- `GET /api/v1/jobs/{id}/events?orgId=` → timeline para a tela de detalhe.
- `GET /api/v1/jobs/{id}/assets?orgId=` → galeria de resultados
  (vazio = "nada produzido ainda").

### Aprovações

- `GET /api/v1/approvals?orgId=` → fila.
- `POST /api/v1/approvals/{id}/decision`
  `{ orgId, decision: 'approve'|'reject', justification }`.
  Só `owner`/`admin` veem o botão de decidir (papel vem de
  `getUserOrganizations()`); o backend reforça com 403.

### Cancelar

`POST /api/v1/jobs/{id}/cancel` `{ orgId, reason? }`.
Job terminal → `409 INVALID_TRANSITION` (desabilitar o botão nesses estados).

## Helpers prontos (lib/)

| Módulo | Uso no frontend |
|---|---|
| `lib/auth.ts` | `getSession()`, `requireUser()`, `requireOrgRole(orgId, roles)`, `getUserOrganizations()` |
| `lib/validators.ts` | Schemas zod (reutilizar no client p/ validação de forms) |
| `lib/jobs/machine.ts` | `canTransition`, `allStates`, `isTerminal` — lógica de UI (quais botões mostrar) |
| `lib/api-keys.ts` | `generateApiKey()` — **somente** em fluxo server-side de emissão |

## Regras de ouro

- Nunca inventar estado: se a API diz `pending`/`503`/vazio, a UI mostra isso.
- `params` de job: validar no client com o schema zod da tool quando houver.
- `requestId`/`x-request-id`: exibir em telas de erro para suporte.
- Rate limit (120 req/min): debounce em buscas; não poll mais que 1x/5s por job.
