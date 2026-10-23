# CATALOG_STATES — Modelo de 6 estados honestos (FASE 4)

> Regra dura: **CONNECTED ≠ READY**. READY só após execução funcional
> comprovada. Nenhuma ferramenta com adapter 501 pode ser READY.

## 1. Os 6 estados

| Estado | Significado | Autoriza uso? |
|---|---|---|
| `NOT_CONFIGURED` | Falta configuração necessária (conta, token, projeto, executor). Nada foi conectado. | Não |
| `CONNECTED` | Adapter registrado + configuração presente, mas **sem execução real aprovada**. | Não (produtivo) |
| `READY` | Executor real conectado, configurado **e com execução funcional comprovada**. | **Sim — único estado que autoriza** |
| `DEGRADED` | Já executou com sucesso antes, mas a última execução real falhou. | Não — requer investigação |
| `SIMULATED` | Execuções declaradamente simuladas (demos, dry-runs). Nunca apresentadas como reais. | Não |
| `ERROR` | Erro conhecido impeditivo, ou execução real que falhou sem sucesso anterior. | Não |

Labels pt-BR e descrições: `TOOL_HEALTH_STATE_LABELS` /
`TOOL_HEALTH_STATE_DESCRIPTIONS` em `lib/catalog/types.ts`.

O `ToolState` legado (`cataloged`, `needs-config`, `in-development`,
`connected`, `operational-tested`, `error`, `unavailable`) continua existindo
em `types.ts` **somente para a UI não quebrar** — o modelo autoritativo é o
`ToolHealthState`, derivado por evidência em `lib/catalog/health.ts`.

## 2. Derivação (evidência, não declaração)

`resolveToolState(tool, overrides)` / `getToolHealth(id, overrides)`
(`lib/catalog/health.ts`) derivam o estado de três sinais:

- **(a) adapter registrado?** — lido de `toolRegistry` (`lib/adapters`).
  Esqueletos 501 têm `executionReady = false`.
- **(b) configurado?** — credenciais/config presente. **Injetado pelo
  chamador** via `overrides.configured` — o Hub ainda não tem cofre/store
  real, então nunca é assumido como `true`.
- **(c) última execução real com sucesso?** — injetado via
  `overrides.lastRealRunOk` (+ `hadRealSuccessBefore`). Sem histórico, o
  **teto é CONNECTED**.

### Ordem de prioridade (`deriveStateFromSignals`)

1. `knownError` presente → `ERROR` (motivo preservado em `reason`).
2. `lastRealRunOk === false` → `DEGRADED` (se `hadRealSuccessBefore`) ou
   `ERROR` (sem sucesso anterior).
3. `executionReady && configured && lastRealRunOk === true` → `READY`.
   Adapter 501 **nunca** satisfaz esta condição.
4. `lastRealRunOk === true && !executionReady` → contradição honesta:
   `CONNECTED` (se configurado) ou `NOT_CONFIGURED`, com `reason` exigindo
   **revalidação** — nunca READY.
5. `simulated && lastRealRunOk !== true` → `SIMULATED`.
6. `configured` → `CONNECTED` (com ou sem adapter; sem execução real).
7. Padrão → `NOT_CONFIGURED`.

### Migração do legado

`mapLegacyStateToHealth()` (`lib/catalog/types.ts`):

| Legado | Novo |
|---|---|
| `cataloged`, `needs-config`, `in-development` | `NOT_CONFIGURED` |
| `connected` | `CONNECTED` |
| `operational-tested` | `READY` |
| `error` | `ERROR` |
| `unavailable` | `ERROR` (ferramentas indisponíveis não entram no catálogo; o motivo vai em `reason`) |

`getToolHealth()` devolve `legacyState` + `legacyMappedState` junto do estado
derivado, para auditoria da migração.

## 3. Retrato honesto (atualizado na FASE 2B, 2026-10-23)

Sem evidência de (b) nem (c) para nenhuma ferramenta — o Hub ainda não tem
cofre de credenciais nem histórico de execuções. Resultado derivado:

| Ferramenta | Legado | Adapter 501? | Estado derivado |
|---|---|---|---|
| vectorcraft | in-development | sim | `NOT_CONFIGURED` |
| designcraft | in-development | não | `NOT_CONFIGURED` |
| photocraft | in-development | não | `NOT_CONFIGURED` |
| lightcraft | in-development | não | `NOT_CONFIGURED` |
| artcraft | in-development | não | `NOT_CONFIGURED` |
| wordcraft | in-development | não | `NOT_CONFIGURED` |
| hyperframes | cataloged | sim | `NOT_CONFIGURED` |
| apify-mcp | needs-config | sim | `NOT_CONFIGURED` |
| playwright-cli | needs-config | não | `NOT_CONFIGURED` |
| gws-cli | needs-config | não | `NOT_CONFIGURED` |
| supabase | needs-config | não | `NOT_CONFIGURED` |
| mkvideos | cataloged | sim | `NOT_CONFIGURED` |

Nenhuma ferramenta declara executor real (`executor: null` nas 12),
nenhuma tem histórico (`history: null`), e os **4** adapters registados
(vectorcraft, hyperframes, apify-mcp, mkvideos) têm
`executionReady = false` — **nenhuma pode ser READY hoje**.

### 3.1 Alinhamento código ↔ seed (FASE 2B, C8)

A Fase 1 mediu divergências entre o catálogo em código
(`lib/catalog/tools.ts`, 12 entradas) e a seed da BD
(`supabase/migrations/0003_seed.sql`, 10 entradas). Resolução pelo lado
do código/documentação (BD e seed aplicada intocadas):

| Divergência medida | Resolução |
|---|---|
| Craft (designcraft, photocraft, lightcraft, artcraft, wordcraft): código `cataloged` ≠ seed `in-development` | ✅ Código alinhado à seed: `in-development` |
| playwright-cli: código `cataloged` ≠ seed `needs-config` | ✅ Código alinhado à seed: `needs-config` |
| gws-cli: código `cataloged` ≠ seed `needs-config` | ✅ Código alinhado à seed: `needs-config` |
| `mkvideos` e `supabase` só existem em código (sem linha na seed) | Documentado: `supabase` é entrada de serviço; `mkvideos` tem o executor do lado da Athena (trabalho do Cláudio). A seed NÃO foi alterada — incluir estas entradas na BD é decisão futura dela, via nova migration |
| Slug: código `gws-cli` ≠ seed/BD `google-workspace-cli` | ⚠️ **DECISÃO NECESSÁRIA da proprietária:** qual é o slug canónico? Renomear em código afeta `SERVICE_IDS`, links da UI e referências; renomear na BD exige migration corretiva. Até à decisão, os dois nomes coexistem e referem a mesma ferramenta (Google Workspace CLI) |

Os estados derivados não mudam com este alinhamento: `cataloged`,
`needs-config` e `in-development` mapeiam todos para `NOT_CONFIGURED`
no modelo de saúde (§2).

## 4. Spec de wiring — GET /api/v1/tools

> O wiring é aplicado pela Cristiane/agente principal. **NÃO editar
> `app/api` nesta fase.** Abaixo a especificação exata.

**Ficheiro:** `app/api/v1/tools/route.ts` (handler `GET` existente).

**Passo 1 — imports** (topo do ficheiro):

```ts
import "@/lib/adapters"; // side-effect: registra os 4 adapters no toolRegistry
import { getToolHealth } from "@/lib/catalog/health";
```

**Passo 2 — estender o DTO.** Em `ToolDTO`, adicionar (sem remover nem
renomear os campos existentes — `status` continua a refletir o valor bruto
da tabela `tools`, nunca um estado inventado):

```ts
export interface ToolHealthDTO {
  state: string;            // ToolHealthState derivado, ex. "NOT_CONFIGURED"
  reason: string;           // explicação honesta
  adapterRegistered: boolean;
  executionReady: boolean;  // false para os esqueletos 501
  configured: boolean;      // evidência injetada (hoje: false)
  contractVersion: string | null;
  legacyState: string | null;
  checkedAt: string;
}
export interface ToolDTO {
  // ... campos existentes ...
  health: ToolHealthDTO | null; // null quando o id não está no catálogo
}
```

**Passo 3 — onde chamar.** Dentro do `GET`, após buscar `data` do Supabase
e antes de `apiJson`, mapear cada linha:

```ts
import { getTool } from "@/lib/catalog/tools";

const tools = (data ?? []).map((r) => {
  const row = r as Record<string, unknown>;
  const id = String(row.id);
  const dto = toToolDTO(row);
  if (!getTool(id)) {
    // id no banco mas fora do catálogo: não inventar saúde
    return { ...dto, health: null };
  }
  const h = getToolHealth(id, {
    // FUTURO: ler de onde a config real estiver (vault/tabela integrations).
    // Hoje: sem cofre → false honesto. Nunca assumir true.
    configured: false,
  });
  return {
    ...dto,
    health: h.found
      ? {
          state: h.state,
          reason: h.reason,
          adapterRegistered: h.signals!.adapterRegistered,
          executionReady: h.signals!.executionReady,
          configured: h.signals!.configured,
          contractVersion: h.contractVersion,
          legacyState: h.legacyState,
          checkedAt: h.checkedAt,
        }
      : null,
  };
});
return apiJson({ tools }, { requestId, headers: rl.headers });
```

**Passo 4 — quando houver cofre/histórico real** (trabalho futuro, fora da
FASE 4): passar `configured`, `lastRealRunOk`, `hadRealSuccessBefore`,
`simulated`, `knownError` lidos do store real para `getToolHealth(id,
overrides)`. Até lá, `configured: false` é o valor honesto.

**Não fazer:** nunca escrever o estado derivado de volta na coluna
`status` da tabela `tools` sem migração aprovada; nunca expor segredos no
DTO; nunca mapear `health.state` para `"READY"` no frontend sem o campo
`executionReady: true` correspondente.
