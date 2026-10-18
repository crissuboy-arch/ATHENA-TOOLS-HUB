# Conectores de Vídeo e Conteúdo — FASE 6

Estado em 2026-10-18. Regra geral: nenhum executor pesado corre no frontend
nem no servidor principal — todos são desenhados para **worker isolado**.
`executionReady: false` em todos até ligação real validada.

| Conector | Adapter | Licença (confirmada) | Estado honesto |
|---|---|---|---|
| MKVideos | `lib/adapters/mkvideos.ts` | MIT (repo próprio da Cristiane) | catalogado — executor vive na Athena (Fase 7) |
| HyperFrames | `lib/adapters/hyperframes.ts` | **Apache-2.0** | catalogado — render só em worker isolado |
| VectorCraft | `lib/adapters/vectorcraft.ts` | **MIT OR Apache-2.0** | em desenvolvimento — primeira candidata a execução real |
| Apify MCP | `lib/adapters/apify-mcp.ts` | serviço pago (assinatura existente) | needs-config — sem token |

## A. MKVideos (`mkvideos`) — video.generate

Referência (só leitura): `~/workspace/mkvideos-ofensiva-criativa`,
branch `feat/athena-mkvideos-adapter` — `docs/athena-integracao.md` e
`src/athena/adapter.ts` (ContratoPonteV1).

**Divisão de responsabilidades:** o Hub NÃO executa o pipeline MKVideos e
NÃO duplica o executor que o Cláudio implementa na Athena (Fase 7). O Hub:
1. regista a ferramenta `mkvideos`;
2. constrói envelopes de missão `CRIAR_VIDEO` válidos
   (`buildCriarVideoMission()` — mesma regra de `mission_id` do adapter:
   `/^[A-Za-z0-9][A-Za-z0-9._:-]{2,80}$/`, `objective` obrigatório,
   `requested_outputs: ["video"]`, skills `explicativo`/`curso`/`demo`,
   `vertical` para 9:16);
3. acompanha jobs por poll de estados `queued`/`running`/`done`/`failed`
   (`toJobSnapshot()` traduz o payload de `athena-status`);
4. expõe o artefacto (`outputs.video`) quando `done`.

O poll real (`mkivideos athena-receive` / `athena-status`) corre num worker
isolado — ainda não ligado, por isso `execute()` lança 501.

**Configuração (futura):** worker com acesso ao CLI `mkivideos` e à fila do
MKVideos. Nada a configurar no Hub até lá.

## B. HyperFrames (`hyperframes`) — video.render

- **Licença confirmada:** Apache-2.0 (`github.com/heygen-com/hyperframes`,
  verificado via API do GitHub em 2026-10-18). Uso comercial livre, sem
  custo por render.
- **O que é:** renderização determinística de composições HTML/CSS/animação
  → MP4 (headless Chromium via puppeteer-core + FFmpeg). NÃO gera avatares
  de IA — o adapter nunca anuncia isso.
- **Requisitos (documentados):** Node.js ≥ 22, FFmpeg, Chromium headless.
- **Contrato real do CLI** (https://hyperframes.heygen.com/packages/cli):
  `init` → `lint` → `check` → `render --output final.mp4
  [--quality draft|looks|delivery] [--docker]`; escala via
  `lambda render` / `cloudrun render` / `cloud render`.
- **Versão pinada:** `0.6.80` por defeito (variável `HYPERFRAMES_VERSION`) —
  mesma versão endurecida no MKVideos; não subir sem render de validação.
- O adapter expõe `buildRenderJobSpec()` — especificação pura do job para o
  worker isolado (sequência lint → check → render, `--json`, update checks
  desligados). `execute()` lança 501 até o worker existir.

**Notas honestas:** telemetria anónima vem ligada por defeito no CLI —
opt-out a confirmar na versão instalada (NÃO VERIFICADO); dependências com
licenças próprias no caminho Lambda (`ffmpeg-static` GPL-3.0 no artefacto,
`mediabunny` MPL-2.0) — ver CREDITS.md do repo antes de redistribuir.

## C. VectorCraft (`vectorcraft`) — vector.generate

- **Licença confirmada:** MIT OR Apache-2.0 (repo `storytold/vectorcraft`
  traz `LICENSE-MIT` + `LICENSE-APACHE`; a API do GitHub reporta Apache-2.0).
  Verificado no README em 2026-10-18. Status do projeto: **alfa**.
- **Contrato real confirmado** (README do repo — nada inventado):
  - `vectorcraft-cli mcp [--automation-read-root <dir> --automation-write-root <dir>]`
    — servidor MCP (stdio) para agentes;
  - `vectorcraft-cli run --in <doc.vectorcraft> --export <out.pdf|svg|png…>`
    — lote headless;
  - `vectorcraft -- --control 7979` — canal de controle JSON.
  - Detalhes: `docs/mcp.md`, `docs/control-protocol.md` no repositório.
- O adapter expõe `resolveVectorCraftConfig()` (lê `VECTORCRAFT_CLI`,
  `VECTORCRAFT_READ_ROOT`, `VECTORCRAFT_WRITE_ROOT` do ambiente do worker),
  `buildCliJobSpec()` e `buildMcpServerSpec()` — specs puras para o worker
  isolado. `execute()` lança 501.
- **Primeira candidata a execução real** (decisão da Cristiane): quando o
  worker estiver pronto, ligar aqui e pôr `executionReady: true` só após
  teste real aprovado.

**Configuração (futura, no worker):** compilar ou instalar o binário
`vectorcraft-cli` (release), definir `VECTORCRAFT_CLI` com o caminho e os
roots de automação confinados ao projeto.

## D. Apify MCP (`apify-mcp`) — research.run

Regras duras da Cristiane: usa-se a **assinatura existente** (via ScalaFlow)
— nunca criar segunda assinatura; a integração ScalaFlow não é tocada;
nenhuma execução sem teto de gasto; tokens só no servidor/vault.

- **APIs oficiais** (docs.apify.com, nada inventado):
  - `POST https://api.apify.com/v2/acts/{autor~actor}/runs` — iniciar run
  - `GET https://api.apify.com/v2/actor-runs/{runId}` — estado
  - `GET https://api.apify.com/v2/datasets/{datasetId}/items` — resultados
  - `POST …/run-sync-get-dataset-items` — síncrono (runs curtos)
  - MCP hospedado: `https://mcp.apify.com?tools=<lista>`
- **Guardrails implementados** (funções puras, testadas):
  - `ApifyBudget` — teto mensal e por job (cêntimos) + allowlist de actors;
  - `ApifyRunRecord`/`ApifyLedger` — registo de execuções; `usageCents`
    só com valor real da API (`null` = desconhecido, nunca inventado);
  - `checkBudget()`, `assertExecutionAllowed()`, `recordRunStart()`,
    `recordRunFinish()`, `monthSpendCents()`.
- **Estado:** `NOT_CONFIGURED` honesto sem `APIFY_TOKEN`. `execute()` lança
  501.

**Configuração** (ambiente do servidor/vault — nunca no cliente):
```
APIFY_TOKEN=<token da assinatura existente>   # via ScalaFlow; sem 2ª assinatura
APIFY_ACTOR_ALLOWLIST=apify/web-scraper,...   # opcional
APIFY_MONTHLY_CAP_CENTS=5000                 # opcional; 0 = sem teto
APIFY_PER_JOB_CAP_CENTS=500                   # opcional; 0 = sem teto
```
O `maxCostCents` continua **obrigatório por job** na validação de params.

## Pendências / NÃO VERIFICADO

- Nenhum dos 4 conectores tem execução real ligada — `execute()` 501 em
  todos; `executionReady: false` em todos.
- Opt-out de telemetria do HyperFrames na versão pinada — NÃO VERIFICADO.
- Render de validação HyperFrames 0.6.80 no worker — NÃO VERIFICADO
  (não subir versão sem ele).
- Worker isolado (Rust/CLI/MCP) — ambiente ainda por provisionar; nada
  corre no frontend Vercel nem na VPS de produção da Athena.
- Registo da tool `mkvideos` em `lib/catalog/tools.ts` — snippet entregue
  no relatório da FASE 6 para aplicação manual.
