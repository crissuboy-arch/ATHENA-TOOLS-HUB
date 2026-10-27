# MoneyPrinterTurbo — integração isolada para ATHENA (rascunho técnico)

## Estado
Adapter TypeScript **criado**, ainda **não ativado**, sem implantação do serviço nem tarefas executadas. Esta branch é separada da branch G3; não fazer merge até a validação.

## Fonte auditada (27/10/2026)
- Upstream: https://github.com/harry0703/MoneyPrinterTurbo (licença MIT).
- Endpoint real FastAPI: `POST /api/v1/videos` para criar produção; `GET /api/v1/tasks/{task_id}` para consultar status. Ambos na `app/controllers/v1/video.py`.
- Resposta do upstream: `{ status: 200, message: "success", data: { task_id: "..." } }`.
- Autenticação: header `x-api-key` quando `app.api_key` estiver configurada (obrigatória no ambiente de integração).
- Documentação do serviço, depois de implantado: `/docs` na porta 8080.

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
                     +-> revisão humana -> publicação opcional
```
ATHENA continua o orquestrador. Cris OS e NEXORA permanecem independentes. Não publicar automaticamente. A integração não modifica as tabelas de CRM.

## Código entregue
`lib/integrations/moneyprinterturbo.ts` fornece `submitVideoToMpt()` e `getMptTask()`. Não existe rota pública, nem registo do executor nem ativação automática: são deliberadamente pendentes de autorização e testes.

## Configuração futura do ambiente do executor
- `MPT_API_BASE_URL`: URL HTTPS privada/restrita do serviço MPT (nunca usar um endpoint de origem arbitrária enviado pelo utilizador).
- `MPT_API_KEY`: chave do serviço MPT, **somente servidor**, criada na instalação.
- Definir `app.api_key` no serviço de destino; sem isto upstream permite chamadas sem autenticação.
- Controle de tráfego na rede, TLS, limites de fila e quotas de custos.
- Não usar `NEXT_PUBLIC_` para credenciais do MPT.
- Servidor de vídeo precisa suportar Python/FFmpeg e arquivos persistentes; não rodar geração de vídeo numa função Vercel de curta duração.

## Gatilhos obrigatórios para ativação
1. ATHENA G3 validado: sessão real, org, `tools`, `jobs`, T1–T7.
2. Teste de container MPT **isolado**, versionado, com imagens e áudios licenciados.
3. Testes de contrato com mock upstream: sucesso, status assíncrono, timeout, falha, limite de quota.
4. Verificação de autorização **server-side** por organização e ferramenta antes do adapter.
5. Persistência/associação de IDs e artefatos sem expor URLs internas ou credenciais; idempotência antes de chamar MPT.
6. Proteger saída e publicação por revisão humana explícita.
7. Implantação apenas em Preview e teste ponta a ponta com tarefa de baixo custo, após autorização.

## O que NÃO foi feito
Não houve instalação Docker, configuração de chaves, deploy de serviço externo, chamada à API real, geração de vídeo, alteração de produção, criação de tabelas ou mudança nas permissões. A presença do arquivo não significa integração funcional.
