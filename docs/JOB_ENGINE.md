# Motor de Execução — Job Engine (FASE 3)

Motor real de execução de jobs do Athena Tools Hub. Despacha jobs `QUEUED`
para adapters com executor real, com concorrência limitada, retries com
backoff, timeouts, heartbeats, recuperação de órfãos e dead-letter queue —
sem nunca simular sucesso.

> **Estado honesto:** se a tool não tem executor real (`executionReady=false`
> ou sem `execute()`), o job permanece `QUEUED` com evento `dispatch_skipped`.
> Nenhum resultado é inventado.

## Arquitetura

```
lib/jobs/
├── machine.ts      máquina de estados pura (8 estados; FASE 3 adiciona RUNNING→QUEUED p/ recuperação)
├── service.ts      persistência + transições auditadas (+ primitivas do worker: claimJob,
│                   appendJobEvent, completeJob, failJob, requeueJob, heartbeats…)
├── worker.ts       Worker: despacho, concorrência, retries, timeout, cost gate, logs estruturados
├── retry.ts        backoff exponencial + jitter (puro, sem I/O)
├── timeout.ts      deadlines + withTimeout/AbortController (puro, sem I/O)
├── heartbeat.ts    heartbeats + deteção/recuperação de órfãos (orquestração com deps injetadas)
├── dead-letter.ts  DLQ sobre jobs FAILED (sem tabela nova; ver § Dead-letter)
└── *.test.ts       61 testes (fakes injetados; sem Supabase, sem rede)
```

Sem coluna nova no schema: heartbeats são eventos `heartbeat` em
`execution_events`; tentativas são eventos `attempt_started`/`attempt_failed`;
a DLQ são jobs `FAILED` com `error.dead_lettered=true` + evento `dead_letter`.

## Estados e transições (o que a FASE 3 usa)

Os 8 estados mantêm-se. Fluxo do worker:

```
QUEUED ──claim atómico──▶ RUNNING ──▶ COMPLETED (com result)
   │                        │
   │                        ├──▶ FAILED (+ dead-letter se esgotar retries/timeout)
   │                        │
   └─(sem executor)── fica QUEUED + dispatch_skipped
```

- **Claim atómico:** `UPDATE … SET state='RUNNING' WHERE state='QUEUED'`
  (condicional). Dois workers a disputar o mesmo job → só um vence; o outro
  recebe `false` e passa ao próximo.
- **RUNNING → QUEUED** (novidade FASE 3): exclusiva da recuperação de órfãos.
  Nunca usada no fluxo normal.
- **Cancelamento:** só de estados não-terminais, via `canTransition`
  (`service.cancelJob`). O worker verifica o estado antes de cada tentativa e
  durante o backoff; job cancelado a meio **não** é completado nem reintentado.

## Componentes

### Worker (`worker.ts`)

```ts
const worker = new Worker({
  orgId,               // obrigatório
  concurrency: 2,      // jobs em paralelo
  pollIntervalMs: 2000,
  retry: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 60_000, multiplier: 2, jitterRatio: 0.25 },
  jobTimeoutMs: 600_000,     // 10 min desde started_at
  attemptTimeoutMs: 300_000,  // 5 min por tentativa
  heartbeat: { heartbeatIntervalMs: 15_000, orphanThresholdMs: 60_000 },
  allowPaidExecution: false, // TRAVA DE CUSTO (ver abaixo)
});
await worker.start();  // recuperação de órfãos → loop até worker.stop()
```

Por `tick()`: (1) sweeper de timeouts, (2) preencher slots livres com claims,
(3) heartbeats dos jobs ativos.

**Decisão de despacho** (por job `QUEUED`, antes do claim):
1. Sem adapter registrado → `dispatch_skipped` (`no_adapter`), fica `QUEUED`.
2. `executionReady=false` → `dispatch_skipped` (`executor_not_ready`), fica `QUEUED`.
3. Sem `execute()` implementado → `dispatch_skipped` (`executor_not_implemented`).
4. **Trava de custo:** `dryRunInfo().estimatedCost` definido e
   `allowPaidExecution=false` → `execution_blocked` (`cost_gate`), fica `QUEUED`.
   Operações com custo/publicação/efeitos externos ficam **bloqueadas sem
   autorização explícita** — é trava de código, não de documentação.
5. Caso contrário: claim atómico → `RUNNING` → `execute(ctx)`.

Cada `dispatch_skipped`/`execution_blocked` é notificado **uma vez por job**
por instância do worker (evita spam de eventos a cada tick).

**Execução com retry:** o job fica `RUNNING` durante backoff; cada tentativa
tem timeout próprio (`withTimeout` + `AbortSignal` no `ExecutionContext`).
Falha → evento `attempt_failed` → backoff → nova tentativa. Esgotado o
orçamento → `FAILED` + dead-letter. O `signal` permite ao executor abortar
trabalho em curso no timeout.

### Retry (`retry.ts`)

`computeBackoffDelayMs(attempt)` = `min(base·multiplier^(attempt-1), max)` ±
jitter. `shouldRetry(attemptsUsed)` compara com `maxAttempts`. Funções puras;
`random` injetável para testes determinísticos.

### Timeout (`timeout.ts`)

`deadlineFor`/`isExpired`/`remainingMs`/`findTimedOutJobs` (puros) +
`withTimeout(promise, ms, label, controller?)` que rejeita com `TimeoutError`
(`code: "TIMEOUT"`) e aborta o signal. O sweeper do worker marca `dead-letter`
(`code: "TIMEOUT"`) em jobs `RUNNING` além de `jobTimeoutMs` sem concluir.

### Heartbeat (`heartbeat.ts`)

O worker envia `heartbeat` (evento com `worker_id`) a cada
`heartbeatIntervalMs` durante execução e backoff. `isOrphaned()` =
sem heartbeat (ou sem `started_at` válido) há mais de `orphanThresholdMs`.

**Recuperação** (`recoverStaleJobs`, no arranque e disponível para sweeper):
1. `RUNNING` além de `jobTimeoutMs` → `FAILED` (`TIMEOUT`) — tem precedência;
2. órfão com tentativas restantes → `QUEUED` (requeue, evento auditado);
3. órfão sem tentativas restantes → `FAILED` + dead-letter (`ORPHAN_UNRECOVERABLE`).

Nada se perde: todo `RUNNING` problemático termina num estado honesto.

### Dead-letter (`dead-letter.ts`)

Sem tabela nova (ver § Schema futuro): evento `dead_letter` + `FAILED` com
`error = { code: "DEAD_LETTER", dead_lettered: true, dead_letter: { reason_code,
attempts_used, max_attempts, last_error, at } }`.
`listDeadLetters(orgId)` lista a fila; `isDeadLettered(error)` deteta a marca.

## Logs estruturados e rastreio

Uma linha JSON por evento relevante:

```json
{"ts":"…","level":"info","worker":"w-abc","orgId":"…","jobId":"…",
 "missionId":"m-123","toolId":"vectorcraft","event":"attempt_failed",
 "message":"tentativa 2 falhou (error): boom"}
```

`missionId` vem de `params.mission_id` (ou `missionId`) quando presente —
rastreio ponta-a-ponta missão → job. `Logger` e `sink` injetáveis.

## Idempotência

`createJob` respeita `UNIQUE(org_id, idempotency_key)`: reenvio devolve o job
existente (`created: false`), incluindo a corrida (trata `23505`).
O worker nunca duplica execução: o claim atómico garante um executor por job.

## Operação

- **Arranque seguro:** `start()` corre `recoverStaleJobs` antes do primeiro
  despacho — jobs de um worker que caiu voltam à fila ou à DLQ, auditados.
- **Paragem graciosa:** `stop()` sai do loop; `start()` aguarda `drain()`
  (jobs ativos terminam).
- **Ajustes:** `orphanThresholdMs` deve ser **maior** que `maxDelayMs` do retry
  (senão o backoff parece órfão); `attemptTimeoutMs ≤ jobTimeoutMs`.
- **Sem executor ainda:** com os adapters atuais (`executionReady=false`), o
  worker só escreve `dispatch_skipped` — comportamento correto e honesto até
  o executor real (ex.: VectorCraft) ser ligado.

## Testes

`npx vitest run lib/jobs` — 61 testes, todos com fakes (store/registry/clock
injetados): despacho honesto, trava de custo, backoff determinístico,
dead-letter, timeout de tentativa, cancelamento a meio do backoff,
concorrência, recuperação no arranque (órfão/timeout/esgotado/saudável) e
validação de configuração. Sem Supabase, sem rede.

## Schema futuro (NÃO implementado — sem migration nesta fase)

Se o volume justificar, migration `0006` poderá adicionar:
- `execution_jobs.last_heartbeat_at timestamptz` + índice (evita N queries na recuperação);
- `execution_jobs.attempts int DEFAULT 0` (orçamento sem contar eventos);
- `execution_jobs.not_before timestamptz` (backoff persistente entre restarts);
- tabela `dead_letter_queue` dedicada (hoje: `FAILED` + `error.dead_lettered`).
