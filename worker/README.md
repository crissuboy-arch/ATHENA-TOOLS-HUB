# Worker contínuo — infraestrutura exata (nada implantado aqui)

O worker é um processo Node de longa duração, FORA da Vercel, que faz
polling à fila Supabase e executa jobs HyperFrames com o adapter real.
Esta pasta só tem os ficheiros prontos (Dockerfile) + este documento.
**Nada foi implantado, nenhuma VPS/produção foi alterada.**

## O que é preciso para correr em contínuo

| Item | Exato |
|---|---|
| Host | Qualquer host Linux x86_64 com Docker — ou VM Linux sem Docker a correr `vite-node` direto. 1 réplica por org (claim atómico permite mais, mas renders são pesados: começar com 1). |
| Runtime | Node.js 24 (imagem `node:24-bookworm-slim`); `vite-node` (vem das devDeps do repo — o Dockerfile usa `npm ci --include=dev`). |
| Dependências | `hyperframes@0.6.80` (global, `--ignore-scripts`); `ffmpeg` + `ffprobe`; Chrome for Testing **156.0.8078.4** (pinado no Dockerfile). **NUNCA chromium 152** — bloqueia a navegação loopback do CLI (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, sem flag que resolva). |
| Recursos | Sem GPU. ~1 vCPU; 2 GB RAM recomendados (cada render lança 1 Chrome, ~256 MB+); ~2 GB disco (node_modules + Chrome + artefactos). Concorrência default 1 (`WORKER_CONCURRENCY`). |
| Rede | Saída para o Supabase (fila) apenas. O render em si é local; o worker NÃO chama APIs pagas nem modos cloud do HyperFrames. |
| Persistência | Volume persistente em `HYPERFRAMES_ARTIFACTS_DIR` (default `/data/hyperframes-artifacts`): sem volume, os MP4 morrem com o contentor. A API devolve o caminho/resultado do job, não o ficheiro — download de artefactos pela API é trabalho futuro, NÃO prometido aqui. |
| Supervisão | `--restart always` (ou o restart do orquestrador). Logs JSON de uma linha (`worker_start`, `job_claimed`, `execution_completed`, `attempt_failed`, `dead_letter`). Paragem graciosa por SIGTERM (jobs ativos terminam; órfãos são recuperados no arranque seguinte — nunca "concluídos" por acidente). |

## Variáveis de ambiente

Obrigatórias (só no ambiente do processo/contentor — nunca no repo):

- `WORKER_ORG_ID` — uuid da org que este worker serve.
- `NEXT_PUBLIC_SUPABASE_URL` — URL do projeto Supabase dedicado.
- `SUPABASE_SERVICE_ROLE_KEY` — chave service_role (server-only; o
  worker impõe org em cada operação, mas a chave bypassa RLS — guardar
  como segredo do host).
- `HYPERFRAMES_WORKER_ENABLED=1` — sem isto, o adapter reporta
  `executionReady=false` e nenhum job HyperFrames despacha. **Nunca**
  definir esta variável na Vercel (o Preview ficaria "ready" sem worker).

Opcionais (defaults do Dockerfile):

- `HYPERFRAMES_CLI` — caminho do `cli.js` (default: global npm).
- `HYPERFRAMES_BROWSER_PATH` — caminho do Chrome (default: CfT instalado).
- `HYPERFRAMES_ARTIFACTS_DIR` — default `/data/hyperframes-artifacts`.
- `WORKER_ID`, `WORKER_CONCURRENCY` (default 1),
  `WORKER_POLL_INTERVAL_MS` (default 2000),
  `WORKER_JOB_TIMEOUT_MS` (default 600000),
  `WORKER_ATTEMPT_TIMEOUT_MS` (default 300000),
  `WORKER_ALLOW_PAID_EXECUTION` (default false — **nunca true** para o
  executor HyperFrames v1, que é local e $0).

## Custos

- **$0 de execução**: licença Apache-2.0, render local, sem chamadas a
  APIs pagas, sem modos cloud/lambda. O único custo possível é o do host
  escolhido — sem valor inventado aqui: depende do host (VPS existente
  dela só com autorização dela, ou outro host à escolha dela).

## Efeito visível quando o worker arrancar

Com o worker a correr e `HYPERFRAMES_WORKER_ENABLED=1` no ambiente
dele, o Hub passa a reportar a HyperFrames como `ready`
(`integrationStatus`) e a UI desbloqueia a criação de tarefas para ela —
é o comportamento pretendido, não um bug. Sem worker, continua `pending`
e a criação continua bloqueada (gate honesto da correção `cc0b490`).

## O que falta para o worker contínuo (fora desta missão)

1. Autorização dela para o host + segredos no host (service_role, org).
2. Build da imagem + arranque com o comando do Dockerfile.
3. Primeira tarefa real contra a base viva (sessão owner/admin dela:
   criar → aprovar → worker executa → consultar resultado) — até lá, a
   prova é o harness isolado (`scripts/demo-first-execution.ts`).
