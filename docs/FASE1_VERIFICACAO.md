# FASE 1 — Verificação do MVP (preservar e completar)

Data: 2026-10-19 · Branch: `feat/mvp-foundation` · Base: d87d89b
Escopo: `app/api/v1/**`, `openapi.yaml`, `lib/errors.ts`, `lib/validators.ts`,
`lib/api-response.ts`, `lib/api-auth.ts`, `lib/rate-limit.ts`, `lib/supabase.ts`,
`lib/auth.ts`, `lib/org-server.ts`, `lib/i18n.ts`, `lib/api-keys.ts` (expansão autorizada).

> Nota de base: o contexto da missão fixava a branch em aadb9ca; a branch avançou
> para d87d89b ("FASE 2 — migrations 0006-0010", só `supabase/migrations/` +
> `supabase/MIGRATIONS.md`, fora deste escopo). O patch foi gerado sobre d87d89b
> para aplicar de forma limpa. Verificada a 0007: adiciona `category_id` e a
> tabela `tool_versions` — NÃO adiciona `status`/`version` a `tools` nem `status`
> a `integrations`; a análise de drift abaixo continua válida.

## 1. Rotas `app/api/v1` — lógica real vs. honesta

| Rota | Método | Estado | Evidência |
|---|---|---|---|
| `/api/v1/health` | GET | **real** | Lê `package.json` (version) + `isSupabaseConfigured()`; sem auth. |
| `/api/v1/tools` | GET | **corrigido** | Query real em `tools`; **drift corrigido**: `status`→`state` (coluna real), `capabilities` agora embutidas de `tool_capabilities`; 503 honesto sem Supabase. |
| `/api/v1/tools/[id]` | GET | **corrigido** | Mesmo `toToolDTO` corrigido; fallback honesto p/ adapter registrado (`in-development`, sem inventar catálogo); 404 se inexistente. |
| `/api/v1/jobs` | GET | **real** | `listJobs` — paginação/filtros reais sobre `execution_jobs` (org-scoped). |
| `/api/v1/jobs` | POST | **real** | `createJob` — idempotência real (`org_id, idempotency_key`), validação contra contrato do adapter, máquina de estados, eventos + auditoria. 201/200+deduplicated. |
| `/api/v1/jobs/[id]` | GET | **real** | `getJob` — linha real de `execution_jobs` (org-scoped); `integrationStatus` honesto. |
| `/api/v1/jobs/[id]/events` | GET | **real** | `getJobEvents` — timeline real de `execution_events`. |
| `/api/v1/jobs/[id]/assets` | GET | **real** | `getJobAssets` — vazio honesto (`[]`) enquanto nada foi produzido; nunca inventado. |
| `/api/v1/jobs/[id]/cancel` | POST | **real** | `cancelJob` — transição validada pela máquina; terminal → 409 `INVALID_TRANSITION`. |
| `/api/v1/approvals` | GET | **real** | `listJobs` com `status=PENDING_APPROVAL`; scope `approvals:decide`. |
| `/api/v1/approvals/[id]/decision` | POST | **real** | `decideApproval` — approve→QUEUED, reject→CANCELLED; owner/admin p/ sessão; aprovador em auditoria. |

Nenhum handler fingia execução: todos chamam o service real (`lib/jobs/service.ts`,
Supabase real, máquina de estados pura em `lib/jobs/machine.ts`). Job states
`CREATED, VALIDATING, PENDING_APPROVAL, QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED`
mantidos — nenhum sucesso de execução é simulado (`integrationStatus: 'pending'`
enquanto nenhum executor real está conectado).

## 2. Drifts código↔schema corrigidos (FASE 1 + achado FASE 11)

### 2.1 CRÍTICO — `lib/api-keys.ts` → `verifyApiKey` (achado FASE 11)
- **Bug:** filtrava `.eq("status", "active")` na tabela `integrations`.
- **Schema real** (`0001_core.sql`): a tabela NÃO tem coluna `status`; tem `state`
  (`tool_state`: 'cataloged', 'needs-config', 'in-development', 'connected',
  'operational-tested', 'error', 'unavailable').
- **Impacto:** contra o schema real, o filtro nunca casava → **toda autenticação
  por API key devolvia 401**. Nenhum teste cobria `verifyApiKey` (por isso os
  122 testes passavam).
- **Correção:** `.eq("state", "connected")` — o valor do enum que significa
  integração ativa.
- **Teste novo:** `lib/api-keys.test.ts` — mock do Supabase que captura a coluna
  filtrada e a valida contra o `CREATE TABLE` real da migration 0001 (se o código
  voltar a filtrar por coluna inexistente, o teste quebra). Cobre: filtro
  `state='connected'`, identidade válida, chave desconhecida → null, erro do
  Supabase → null, hash inválido → null, sem configuração → null (sem rede),
  chave vazia → null, round-trip `generateApiKey`→`verifyApiKey`.
- **Nota:** 'operational-tested' também indicaria integração saudável, mas a
  instrução da missão fixou 'connected'; registado como decisão, não como bug.

### 2.2 `app/api/v1/tools/route.ts` → `toToolDTO`
- `status: row.status ?? "unknown"` → **sempre "unknown"** contra o schema real
  (coluna chama-se `state`). Corrigido para `row.state`.
- `capabilities: row.capabilities ?? []` → **sempre `[]`** (a tabela `tools` não
  tem essa coluna; as capabilities reais vivem em `tool_capabilities`).
  Corrigido: o GET embute `tool_capabilities(name)` e o DTO mapeia os nomes.
- `version`: a tabela `tools` não tem coluna de versão — mantido o default
  honesto `"0.0.0"` (documentado no código e no openapi); histórico de versões
  existe em `tool_versions` (FASE 2, fora deste escopo).

### 2.3 `lib/validators.ts` → `integrationConfigSchema` (dormente, só usada em testes)
- `type: ["api_key", "webhook", "mcp"]` → valores reais do enum `integration_type`:
  `["mcp", "cli", "api", "webhook", "sdk"]` ("api_key" não existe no schema).
- `status: ["active", "disabled"]` → coluna real `state` com os 7 valores de
  `tool_state`, default `"cataloged"` (default do banco). Teste em
  `lib/validators.test.ts` atualizado.

### 2.4 Verificados SEM drift no escopo
`lib/jobs/service.ts` (fora do escopo, mas chamado pelas rotas): usa `state`,
`tool_slug` (0004), `org_id`, `idempotency_key` — alinhado. `lib/auth.ts`:
`organization_members(user_id, org_id, role)` — alinhado. `lib/errors.ts`,
`lib/api-response.ts`, `lib/rate-limit.ts`, `lib/supabase.ts`, `lib/org-server.ts`,
`lib/api-auth.ts`: lógica real, sem referências a colunas.

## 3. Módulos do i18n — "conectados a dados reais" vs. indisponíveis

`lib/i18n.ts` dizia (landing `honestNote`): *"alguns módulos ainda estão sendo
conectados a dados reais"* — vago. Verificação módulo a módulo e novo texto:

| Módulo (landing) | Estado real | Fonte de dados |
|---|---|---|
| Catálogo | **dados reais** | UI: 11 contratos reais de `lib/catalog/tools.ts`; API `/api/v1/tools` lê a tabela `tools` |
| Execuções | **dados reais** | `JobsClient` → `GET /api/v1/jobs` (org-scoped) |
| Aprovações | **dados reais** | `ApprovalsClient` → `GET /api/v1/approvals` + `POST …/decision` |
| Resultados | **dados reais** | `ResultsClient` → `GET /api/v1/jobs?status=COMPLETED` + `GET /api/v1/jobs/{id}/assets` |
| Integrações | **parcialmente em construção** | Página mostra catálogo local de serviços com estados honestos; botão "Testar conexão" **desabilitado** (endpoint `POST /api/v1/integrations/[id]/test` não existe); sem `GET /api/v1/integrations` |
| Engenharia Reversa | **indisponível (honesto)** | Upload desabilitado; banner "endpoint em construção"; histórico vazio honesto (`POST /api/v1/re-jobs` não existe) |
| Governança | **dados reais (backend)** | `audit_logs` escrito em cada transição/decisão; visível nas timelines de job/aprovação; sem página dedicada |

Novo `honestNote`: *"Catálogo, Execuções, Aprovações, Resultados e Governança usam
dados reais; Integrações e Engenharia Reversa têm partes ainda em construção —
marcadas como tal na interface."*

Banner `setup.*` ("Conecte o Supabase para ativar dados reais"): exibido em
`app/(app)/layout.tsx` **só** quando `isSupabaseConfigured()` é falso, dispensável,
nunca bloqueante — comportamento honesto, mantido. Texto do banner já dizia
"Nenhum dado de exemplo é exibido como real" — verdadeiro (páginas mostram
estados vazios, não fictícios).

**Decisão de escopo:** não foram criados endpoints novos (`/api/v1/integrations`,
`/api/v1/results`) — o MVP preserva a superfície atual; os módulos afetados já
estão marcados como indisponíveis/em construção na própria interface.

## 4. `openapi.yaml` — cobertura das rotas

O `grep` por `"  /api"` dava 0 porque o ficheiro segue a convenção OpenAPI
correta: `servers[].url` inclui `/api/v1` e `paths:` lista os caminhos relativos
(`/health`, `/tools`, …). **As 10 rotas de `app/api/v1` já estavam documentadas**
— nenhuma faltava. Completado nesta fase:
- Novos responses reutilizáveis: `Forbidden` (403) e `RateLimited` (429 + header `Retry-After`).
- Cada rota agora documenta os erros que o handler realmente devolve
  (antes: p.ex. `GET /jobs` não documentava nenhum erro; `GET /approvals`
  nenhum; `GET …/events` e `…/assets` nenhum).
- Schema `Tool`: documentado o mapeamento honesto (`status`←`state`,
  `capabilities`←`tool_capabilities`, `version` default `"0.0.0"`).
- `/api/v1` mantido compatível: nenhuma rota, método ou campo removido/renomeado.

## 5. Gates executados

| Gate | Resultado |
|---|---|
| `npx vitest run` | **129/129 PASS** (9 ficheiros; 122 anteriores + 7 novos em `lib/api-keys.test.ts`) |
| `npx tsc --noEmit` | **0 erros** |
| `npx eslint` (escopo) | **0 erros** |

## 6. NÃO VERIFICADO (e porquê)

- **Comportamento contra Supabase live:** sem credenciais por regra da missão
  (nunca aplicar nada ao banco live); os testes validam o SQL da migration como
  fonte do schema, não o banco em execução. O `select("*, tool_capabilities(name)")`
  depende do FK `tool_capabilities.tool_id → tools.id` (existe na 0001) — o
  embed PostgREST é o comportamento padrão, mas só o banco live o provaria.
- **Fluxo m2m ponta-a-ponta** (emitir chave → `verifyApiKey` → `authenticate` →
  rota): `verifyApiKey` agora é testado com mock fiel ao schema; a emissão de
  chaves está fora do escopo do MVP (documentado em `docs/ATHENA_INTEGRATION.md`).
- **`next build`:** fora do protocolo de entrega desta fase (gates: vitest, tsc,
  eslint); nenhuma mudança altera tipos de página ou config de build.
- **Dashboard `app/(app)/page.tsx`:** fora do escopo de ficheiros; regista-se que
  chama `/api/v1/integrations` e `/api/v1/results` (inexistentes → erro honesto
  na UI) — fiação do dashboard fica para fase posterior.
