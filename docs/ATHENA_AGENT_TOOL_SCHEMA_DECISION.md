# DECISÃO PENDENTE — Associação agente ↔ ferramenta (schema)

**Estado:** 26/10/2026 · **Branch:** `feat/athena-connect-discovery`
**Decide quem:** Cristiane, ou decisão conjunta Cristiane + Cláudio (a
decisão afeta o lado ATHENA: que identidade uma chave representa).
**Nesta etapa: NENHUMA migration foi criada, proposta como SQL aplicado
ou aplicada.** Nenhuma base foi tocada. O que existe é a primitiva pura
fail-closed (`lib/athena/agent-permissions.ts`) e a sua anotação na
descoberta (`agentPermissions.linked: false`).

## O problema (prova, não opinião)

1. A tabela `agent_tool_permissions` existe no schema (migration 0008:
   `allowed`, `scopes`, `max_cost_cents`, única por agente+tool) — mas,
   até esta branch, **nenhum código a lia ou aplicava**. As missões
   autorizavam só por scope da chave, sem verificar se o agente podia
   usar aquela tool.
2. **Bloqueio 1 — falta o vínculo integração↔agente.** A tabela
   `integrations` não tem `agent_id`. Quando a ATHENA chama com uma
   chave, o Hub sabe a org e a integração — mas não sabe **que agente**
   a chave representa. Sem isso, não há linha de
   `agent_tool_permissions` para consultar.
3. **Bloqueio 2 — UUID vs slug.** `agent_tool_permissions.tool_id` é um
   UUID (chave da tabela `tools`), mas missões e contratos usam **slugs**
   (`vectorcraft`, `hyperframes`, …). É preciso resolver uuid→slug
   antes de comparar — resolução que hoje não existe na intake.
4. **Porque NÃO foi ligado à intake nesta branch.** Com os dois
   bloqueios, ligar `checkAgentToolAccess` ao `POST
   /api/v1/athena/missions` hoje só teria dois resultados possíveis, os
   dois errados: negar tudo (nenhuma linha resolvível) ou permitir tudo
   (default permissivo inventado). A primitiva foi implementada
   fail-closed e **deliberadamente não ligada** — ligar com um default
   inventado seria pior do que declarar `linked: false`.

## Regras da primitiva já implementada (não mudam com a decisão)

`checkAgentToolAccess(rows, toolSlug, capability?)`, em
`lib/athena/agent-permissions.ts` (5 testes, todos fail-closed):

- Sem linha → **NEGADO** (`no-agent-permission-row`).
- `allowed = false` → **NEGADO**.
- Capability fora de `scopes` → **NEGADO**.
- `scopes` vazios = todas as capabilities (regra do schema, não
  invenção).
- As linhas recebidas têm de vir **já resolvidas uuid→slug**.

## Solução recomendada — Opção A (aditiva, mínima)

**Acrescentar `agent_id` (UUID, nullable, → `agents.id`) à tabela
`integrations`, e resolver uuid→slug de `agent_tool_permissions` na
intake via lookup na tabela `tools`.**

Fundamentação:

- **Aditiva e sem backfill.** Coluna nullable: integrações existentes
  continuam a funcionar (sem agente = sem verificação por agente, com
  o comportamento atual por scope — declarado, não escondido). Nenhum
  dado existente muda de significado.
- **Um agente por integração é o modelo real de hoje.** A chave da
  ATHENA é emitida por integração; mapear 1 integração → 1 agente
  reflete o uso previsto sem introduzir uma tabela de junção nova.
- **Resolução uuid→slug é uma lookup, não um redesign.** A intake
  resolve as linhas do agente (por `agent_id` da integração) para slugs
  e aplica `checkAgentToolAccess` antes de criar o job — sem linha →
  nega; com linha → aplica `allowed`/`scopes`/`max_cost_cents`.
- **Fail-closed por omissão.** Integração sem `agent_id` ou agente sem
  linha para a tool = negado quando a verificação por agente estiver
  ligada. O default permissivo nunca é assumido.
- **Reversível.** A coluna pode ficar por preencher e a verificação
  pode ser desligada por flag sem apagar dados.

Passos após a decisão (NÃO executados aqui, por ordem):

1. Escrever a migration (aditiva, idempotente, sem backfill) e revê-la
   com a Cristiane antes de qualquer aplicação.
2. Aplicar só com autorização explícita dela (gate de migration, como
   todas as anteriores).
3. Resolver uuid→slug na intake e ligar `checkAgentToolAccess` ao `POST
   /api/v1/athena/missions` (antes da criação do job).
4. Testar: agente sem linha → negado; `allowed=false` → negado;
   capability fora de scope → negado; agente com linha → permitido.
5. Atualizar `GET /api/v1/athena/tools` para `agentPermissions.linked:
   true` quando o vínculo existir de facto.

## Alternativas consideradas (e porque não são a recomendação)

- **Opção B — tabela de junção `integration_agents`
  (`integration_id`, `agent_id`).** Mais flexível (vários agentes por
  integração), mas mais peças móveis para um uso que hoje é 1:1.
  Reconsiderar se a ATHENA passar a operar vários agentes pela mesma
  chave — nesse caso, a Opção B torna-se a correta.
- **Opção C — identidade do agente nos metadados da chave no momento
  da emissão.** Rejeitada: chaves são por integração, não por agente;
  confundir credencial com identidade impede rotação e auditoria
  limpas.

## O que a decisão desbloqueia (e o que NÃO desbloqueia)

- **Desbloqueia:** ligar a verificação por agente à intake; emitir
  chaves com âmbito por agente; G3 ponta a ponta com chaves de âmbito
  real; missões reais com permissão por agente.
- **NÃO desbloqueia, sozinha:** executor real (0 prontos — ver
  `docs/ATHENA_INTEGRATION.md` § "O que falta"), T4
  (`HUB_SIGNING_SECRETS_JSON`), login definitivo, nem o lado ATHENA
  (merges/deploy do Cláudio). A decisão de schema é o passo 1, não o
  único passo.

## Riscos se a decisão for adiada ou mal tomada

- **Adiar:** missões continuam autorizadas só por scope da chave —
  qualquer agente com a chave usa qualquer tool. Aceitável em testes
  com mocks; inaceitável em missões reais.
- **Default permissivo:** permitir quando não há linha transforma a
  tabela de permissões em decoração — pior do que não ter tabela.
- **Default de negação total sem migração de dados:** bloquearia
  integrações legítimas já registadas (ex.: o registo G2.5) até serem
  mapeadas — por isso a coluna é nullable e o rollout é por
  integração, não global.

## Registo da decisão (a preencher por quem decidir)

- Decisão: [ ] Opção A / [ ] Opção B / [ ] outra: _______________
- Decidido por: _______________ · Data: _______________
- Migration autorizada: [ ] não / [ ] sim, branch: _______________
