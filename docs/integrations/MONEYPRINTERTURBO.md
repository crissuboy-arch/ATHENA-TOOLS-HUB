# MoneyPrinterTurbo — integração isolada para ATHENA

## Estado (27/10/2026, branch `feat/moneyprinterturbo-adapter`)
Adapter TypeScript **estendido e testado** (22/22 testes), ficheiros de
implantação isolada **prontos** (Dockerfile + compose + config de exemplo),
**vídeo de teste PT-BR real gerado localmente** (1080×1920, 25,73 s, com
narração, legendas queimadas e música de fundo misturada).
**NÃO ativado**: nenhum executor registado, nenhuma rota pública, nenhuma
ligação à intake G3, nenhum serviço implantado fora deste VM, nenhuma
publicação. Esta branch é separada da branch G3; não fazer merge até validação.

## Fonte auditada
- Upstream: https://github.com/harry0703/MoneyPrinterTurbo (licença MIT),
  commit auditado `950ba89899d3b6ef080c18ad5791e7c9ead0ac66`.
- Pacote oficial: `mpt` 1.3.9 no PyPI (o pacote `MoneyPrinterTurbo` é de
  terceiros — NÃO usar). O pacote instala o módulo `app`; o servidor API
  arranca com `uvicorn app.asgi:app` (não existe subcomando `mpt api`).
- Endpoint real FastAPI: `POST /api/v1/videos` para criar produção;
  `GET /api/v1/tasks/{task_id}` para consultar status;
  `GET /api/v1/download/{task_id}/{ficheiro}` para baixar o artefato;
  `DELETE /api/v1/tasks/{task_id}` para apagar. Todos em
  `app/controllers/v1/video.py`. Documentação do serviço, depois de
  implantado: `/docs` na porta 8080.
- Resposta do upstream: `{ status: 200, message: "success", data: {...} }`.
- Estados da tarefa (`app/models/const.py`): PROCESSING = 4, COMPLETE = 1,
  FAILED = -1. A consulta devolve ainda `progress`, `videos`,
  `combined_videos`, `failed_stage` e `error`.
- Autenticação: header `x-api-key` quando `app.api_key` está configurada.
  Com chave vazia o upstream **não autentica** — por isso a integração
  EXIGE sempre chave no adapter (mais restritiva que o upstream).
- Fila: `max_concurrent_tasks` = 5 e `max_queued_tasks` = 100 por omissão;
  fila cheia responde HTTP 429. O adapter nunca reenvia automaticamente.
- Idioma: o upstream usa o formato locale (`pt-BR`, não `pt`); a voz
  PT-BR listada no upstream é `pt-BR-FranciscaNeural`.

## Divergências adapter ↔ upstream (auditadas e corrigidas nesta branch)
1. O adapter original não interpretava estados nem extraía URLs de vídeo —
   agora existem `MptTaskStatus`, `MPT_TASK_STATE`, `pollMptTask()` e
   `getMptTaskVideoUrls()`.
2. O adapter original não distinguia fila cheia — agora HTTP 429 tem erro
   próprio e nunca dispara novo envio.
3. O adapter original não baixava artefatos — agora `downloadMptArtifact()`
   só aceita caminhos relativos a tarefas (`tasks/<id>/<ficheiro>`), sempre
   com `x-api-key`, porque a barra do navegador não envia o header.
4. Timeout fixo de 60 s — agora `MPT_TIMEOUT_MS` (1000–300000, omissão 60 s).
5. Sem limite de envio no cliente — agora `MPT_MAX_INFLIGHT` (omissão 5,
   igual ao concorrente do upstream; 0 bloqueia tudo).
6. Sem construtor PT-BR — agora `buildPtBrVerticalRequest()` (locale
   `pt-BR`, 9:16, voz `pt-BR-FranciscaNeural`, legendas ligadas).
7. Sem gate de publicação — agora `moneyprinterturbo-publish.ts`:
   `requireHumanApproval()` + `buildPublishHold()` (estado
   `awaiting-human-post`; a publicação em si é manual, fora da API).
8. Sem caminho Athena — agora `moneyprinterturbo-job.ts`:
   `prepareAuthorizedMptJob()` valida organização, ferramenta e autorização
   e devolve um job `authorized-not-submitted`. NÃO submete, NÃO regista
   executor, NÃO toca na intake G3.

## Arquitetura
```text
Usuário -> ATHENA (Auth + org + RBAC + aprovação)
                     |
                     | tarefa autorizada / ID interno / idempotência
                     v
             Executor MPT isolado
                     |
                     | x-api-key (somente servidor)
                     v
            MoneyPrinterTurbo API + workers
                     |
                     +-> status de produção / link de vídeo
                     v
             ATHENA associa artefato à tarefa
                     |
                     +-> revisão humana -> publicação MANUAL opcional
```
ATHENA continua o orquestrador. Cris OS e NEXORA permanecem independentes.
Não publicar automaticamente. A integração não modifica as tabelas de CRM.

## Código entregue
- `lib/integrations/moneyprinterturbo.ts` — `submitVideoToMpt()`,
  `getMptTask()`, `getMptTaskStatus()`, `pollMptTask()`,
  `getMptTaskVideoUrls()`, `downloadMptArtifact()`,
  `buildPtBrVerticalRequest()`. `server-only`.
- `lib/integrations/moneyprinterturbo-publish.ts` — gate de revisão humana.
- `lib/integrations/moneyprinterturbo-job.ts` — preparação do job Athena.
- Testes: `moneyprinterturbo.test.ts` (7, originais) +
  `moneyprinterturbo.extended.test.ts` (10) +
  `moneyprinterturbo-gates.test.ts` (5) = **22/22 PASS**.
- `docker/moneyprinterturbo/` — `Dockerfile`, `docker-compose.yml`,
  `config.example.toml`, `test-video-ptbr/` (roteiro, materiais, narração
  Piper, guiões de teste). `config.toml` e `storage/` estão no `.gitignore`.

## Variáveis de ambiente (lado ATHENA, nunca no repo, nunca `NEXT_PUBLIC_`)
| Variável | Omite | Descrição |
|---|---|---|
| `MPT_API_BASE_URL` | — (obrigatória) | URL do serviço MPT. HTTPS obrigatório fora de loopback; sem credenciais, query ou fragmento. |
| `MPT_API_KEY` | — (obrigatória) | Chave `x-api-key`, só servidor. Sem ela o adapter recusa tudo (fail-closed). |
| `MPT_TIMEOUT_MS` | 60000 | Timeout por chamada, 1000–300000 ms. Valor inválido recusa a chamada. |
| `MPT_MAX_INFLIGHT` | 5 | Criações simultâneas no cliente; 0 bloqueia tudo. O limite real vive no servidor (429). |

Lado do motor (em `config.toml`, nunca commitado): `listen_host`
(`127.0.0.1`), `listen_port` (8080), `app.api_key` (obrigatória na
integração), `max_concurrent_tasks` (2 no exemplo isolado),
`max_queued_tasks` (20), `video_source` (`local`), `subtitle_provider`
(`edge` ou `whisper`), `[whisper] model_size` (`tiny` no teste local).

## Implantação isolada (preparada, NÃO implantada fora deste VM)
```sh
cd docker/moneyprinterturbo
cp config.example.toml config.toml   # definir api_key real primeiro
docker compose up -d --build api     # só loopback 127.0.0.1:8080
```
O motor fica fora do frontend Vercel (funções de curta duração não servem
para renderizar vídeo) e fora de qualquer serviço existente. Docker NÃO
existe neste VM — a imagem e o compose NÃO foram testados a construir;
são ficheiros prontos para um anfitrião com Docker, com autorização à parte.
O caminho validado neste VM foi o pacote `mpt` local (ver abaixo).

## Teste PT-BR real (executado 27/10/2026, $0)
Roteiro original em `docker/moneyprinterturbo/test-video-ptbr/script-ptbr.txt`
("Aveiro, a Veneza de Portugal"). Materiais locais gerados por FFmpeg
(3 clipes 720×1280, 6 s). Narração offline Piper `pt_BR-cadu-medium`
(25,73 s). Legendas faster-whisper `tiny` local (idioma detetado `pt`,
probabilidade 1,00).

- **Tentativa 1 (Edge TTS) — FALHOU na etapa de áudio**: o `mpt` não passa
  o proxy ao `edge-tts`, e a rede deste VM intercepta o TLS direto para
  `speech.platform.bing.com:443` (`SSL: WRONG_VERSION_NUMBER`). O `curl`
  pelo proxy do ambiente chega ao anfitrião (HTTP 400), mas o `edge-tts`
  não usa o proxy. Conclusão: Edge TTS NÃO funciona a partir deste VM
  sem alteração ao upstream — por isso o teste seguiu pela via local.
- **Tentativa 2 (CLI local) — VÍDEO GERADO**: tarefa
  `90d45d9b-13a6-47a0-bcad-05c5ef9d0fc3`, `final-1.mp4` 1080×1920,
  25,73 s, 924 869 bytes, com narração, legendas queimadas (verificadas
  num fotograma aos 5 s: "Os barcos moliceiros deslizam pelos canais") e
  música de fundo misturada (evidência indireta forte: 0 silêncios ≥0,5 s
  no áudio final contra 6 na narração isolada; o nome da faixa não consta
  nos logs, por isso a música NÃO está confirmada por título).
- **Tentativa 3 (API local) — ver secção abaixo.** Primeira passagem sem
  legendas (config herdada com `subtitle_provider = "edge"`) gerou vídeo
  sem legendas; corrigida a config para `whisper`, o vídeo final inclui
  legendas.

Cópias do vídeo e do SRT do teste 2:
`~/workspace/research_notes/moneyprinterturbo-athena/video-teste-ptbr-9x16.mp4`
e `video-teste-ptbr-9x16.srt`. O vídeo é material de teste, NÃO publicado.

## Validação via API local (27/10/2026, loopback 127.0.0.1:18080)
Servidor `uvicorn app.asgi:app` com `MPT_HOME` do teste e `api_key` só de
teste local. Resultados provados: `/docs` 200; `GET /api/v1/tasks/...` sem
chave → 401; com chave, tarefa inexistente → 404; `POST /api/v1/videos`
→ 200 com `task_id` (`71604fb6-a56e-43f4-bca1-0e8d76ee9558`); polling
até estado terminal FAILED com `failed_stage: "audio"` e erro explícito.
(Ver `research_notes/moneyprinterturbo-athena/api-poll-2026-10-27.log`.)

**Render completo via API NÃO conseguido — duas causas independentes:**
1. Edge TTS inalcançável a partir deste VM (ver tentativa 1 acima).
2. A API só aceita `custom_audio_file` já dentro do diretório da própria
   tarefa (`app/services/task.py: resolve_custom_audio_file`, só o CLI
   local pode apontar ficheiros do anfitrião). Como o `task_id` nasce no
   POST, um cliente só-API não consegue lá colocar a narração Piper
   antes da etapa de áudio. Consequência: o download de artefacto via API
   está validado apenas por testes mock do adapter, NÃO ao vivo.
O servidor foi parado no fim do teste; **nenhum serviço ficou no ar**.

## Custos ($0 nesta fase)
Pacote `mpt` gratuito (MIT); Piper + voz `pt_BR-cadu-medium` gratuitos;
faster-whisper `tiny` gratuito; FFmpeg gratuito; materiais locais gerados
por FFmpeg; sem OpenAI, ElevenLabs, Seedance, Pexels ou qualquer chave
paga. Custos futuros só com autorização: anfitrião Docker para o motor
isolado (fora do Vercel Hobby) e, se algum dia se quiser voz Edge em
produção, rede que permita o acesso ao `speech.platform.bing.com`.

## Gatilhos obrigatórios para ativação (todos pendentes)
1. ATHENA G3 validado: sessão real, org, `tools`, `jobs`, T1–T7.
2. Anfitrião autorizado com Docker para o motor isolado + teste de build
   da imagem (não testado neste VM).
3. Autorização da Cristiane para a implantação Preview e para a chave
   `MPT_API_KEY` real (gerada localmente, guardada fora do git).
4. Teste ponta a ponta na Preview com tarefa de baixo custo, após autorização.
5. Verificação de autorização **server-side** por organização e ferramenta
   antes do adapter (o `prepareAuthorizedMptJob` é só a validação local).
6. Persistência/associação de IDs e artefatos sem expor URLs internas ou
   credenciais; idempotência antes de chamar MPT.
7. Proteger saída e publicação por revisão humana explícita (gate já existe
   em código; a publicação continua manual).

## O que NÃO foi feito
Não houve deploy de serviço externo, alteração de produção, alteração à
VPS, criação de tabelas, mudança de permissões, registo de executor,
ligação à intake G3, publicação em rede social, gasto pago ou consumo de
créditos. O servidor API local foi parado após o teste. A presença dos
ficheiros não significa integração funcional em produção.
