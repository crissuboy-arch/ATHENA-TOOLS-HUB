# FASE 2D — Plano de migração (0011) e rollback (C3 + C5)

**Estado em 2026-10-23:** a migration está **PREPARADA** e o código está
**IMPLEMENTADO** na branch `feat/fase-2d-c3-c5`. **Nada foi aplicado a
base nenhuma, nada está ativo em produção** (não há deploy autorizado).
Aplicar, validar e ativar são gates separados, cada um com autorização
expressa da Cristiane — este documento diz exatamente o que acontece em
cada um e como se volta atrás.

Spec de origem: `docs/FASE2C_C3_C5_SPEC.md` (decisões ratificadas:
assinatura HMAC Opção A — segredo dedicado em cofre; TTL default das
chaves = 90 dias; aprovações exclusivamente humanas; a Athena nunca
recebe `approvals:decide`).

---

## 1. O que a 0011 faz, tabela a tabela

Ficheiro: `supabase/migrations/0011_api_keys.sql` (re-executável:
`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` em tudo).

| Objeto | O que é | Notas |
|---|---|---|
| `public.api_keys` | Uma linha por chave m2m emitida: `key_hash` UNIQUE (só o hash SHA-256 — nunca a chave), `org_id`, `integration_id`, `label`, `scopes`, `signing_secret_ref` (referência p/ o cofre — nunca o segredo), `expires_at`, `last_used_at`, `revoked_at`, `replaced_by_id` | Lookup de autenticação passa a O(1) pelo índice UNIQUE (fecha B6); a expiração e a revogação passam a ser dados, não cirurgia manual |
| `public.api_request_nonces` | Nonces anti-replay persistentes, PK `(api_key_id, nonce)`, `expires_at = request_ts + 600 s` | Insert-first: a unicidade é imposta pela BD, atomicamente, em todas as instâncias (fecha a metade de persistência de B2) |
| Índices | `api_keys_org_idx`, `api_keys_expires_idx` (parcial, p/ o relatório de expirações), `api_request_nonces_expires_idx` | O lookup usa o UNIQUE de `key_hash` |
| RLS | Ativa nas duas tabelas, com **ZERO policies** para `anon`/`authenticated` — de propósito | Fail-closed (fecha B5): nenhum membro de org lê hashes via PostgREST; acesso só `service_role` no servidor, como em toda a API v1 |
| Backfill | Copia os hashes legados de `integrations.config` (`apiKeyHash` + `scopes`) para `api_keys`, sem tocar nos valores crus | Se nenhuma chave tiver sido emitida manualmente até lá, insere zero linhas — é seguro nos dois mundos |

A 0011 **não** altera nenhuma tabela existente, **não** apaga o campo
legado `integrations.config.apiKeyHash` (isso é a futura 0012, gate G5)
e **não** cria funções nem enums novos.

---

## 2. Como o código se comporta antes/depois (sem flags escondidas)

| Situação | Autenticação | Anti-replay | Gestão de chaves |
|---|---|---|---|
| **Pré-0011** (hoje, em qualquer base sem a migration) | Caminho legado intacto: varredura de `integrations` com `state='connected'` | Em memória, por instância (como sempre foi) | Endpoints devolvem **501 honesto** ("0011 preparada, não aplicada") |
| **Pós-0011, sem flags** | Tabela `api_keys` primeiro (O(1)); sem linha lá → fallback legado. Revogada/expirada na tabela = recusada, sem ressurreição pelo legado | Nonces persistentes para chaves da tabela; memória para legadas | Emissão/listagem/revogação operacionais |
| **Pós-0011 + `HUB_REQUIRE_SIGNATURES=true`** (gate G4) | Idem | Idem, **+ assinatura HMAC obrigatória** para chaves da tabela | Idem |

Configuração do servidor (ambiente, nunca no repo):

- `HUB_SIGNING_SECRETS_JSON` — objeto JSON `{ "<signing_secret_ref>": "<hub_sign_…>" }`.
  Por desenho, a referência **é o id da chave** devolvido na emissão.
  É aqui que o "cofre" do lado do Hub vive nesta fase: a variável de
  ambiente do servidor. A Athena guarda a cópia dela no vault dela.
- `HUB_REQUIRE_SIGNATURES` — ausente/`false` = assinatura opcional
  (mas sempre validada quando apresentada); `true` = obrigatória (G4).
- `HUB_API_KEYS_LEGACY_FALLBACK` — ausente/`true` = legado ativo como
  rede de segurança; `false` = só a tabela autentica (fim da transição).

### 2.1 Classificação de erros da BD (REVISÃO PRÉ-G2, 2026-10-23)

A transição tem exatamente **um** sinal de "mundo pré-0011": a tabela
comprovadamente inexistente. Todos os outros erros falham fechados —
um erro de BD a meio da transição não pode rebaixar a segurança em
silêncio. A mesma classificação governa os dois pontos de leitura/
escrita (lookup em `api_keys` em `lib/api-keys.ts`; insert do nonce em
`lib/api-signing.ts`) e é a que os endpoints de gestão já seguiam
(501 = tabela em falta; 500 = resto):

| Situação | Autenticação (`verifyApiKey`) | Nonce (`registerNonce`) |
|---|---|---|
| Tabela inexistente — `42P01`, `PGRST205`, ou mensagem inequívoca ("relation … does not exist" / "could not find the table") | Fallback legado (compatibilidade pré-0011) | Store em memória, **declarado** no resultado (`memory-fallback`) |
| Linha encontrada, revogada ou expirada | Recusa decisiva → 401 no chamador; o legado **nunca** é consultado | — |
| Sem linha na tabela | Fallback legado (transição) | — |
| Conflito de PK no nonce (`23505`) | — | `401 REPLAY_DETECTED` |
| Conexão, permissão (`42501`), timeout, erro genérico de consulta, **ou exceção inesperada do cliente** | **500 fail-closed** — sem fallback legado | **500 fail-closed** — sem degradar para memória; o nonce também **não** fica registado em memória |

Consequência prática pós-0011: se a BD ficar indisponível, os pedidos
m2m falham com 500 em vez de autenticarem pelo caminho antigo — é
deliberado. Antes da revisão, uma exceção no insert do nonce degradava
para memória e um erro qualquer na leitura de `api_keys` abria o
legado; ambos os buracos estão fechados e cobertos por testes
negativos (`tests/api-keys-error-classification.test.ts`,
`tests/api-signing-fail-closed.test.ts`), incluindo a repetição de um
nonce depois de uma falha a meio do pedido: **a falha não lava o
nonce** — consumido insert-first, a repetição é `REPLAY_DETECTED`
nos dois stores.

---

## 3. Gates de aplicação (ordem obrigatória)

### G2 — Aplicar a 0011 (decisão da Cristiane; execução manual no SQL editor)
Pré-condições: suite da branch verde (`npm test`, `typecheck`, `lint`,
`build`); leitura integral do ficheiro da migration; projeto alvo
confirmado (o dedicado do Hub). Execução: colar
`supabase/migrations/0011_api_keys.sql` no SQL editor e correr uma vez
(é re-executável — correr duas vezes não duplica nada).

### G2.5 — Registo inicial da Athena em `integrations` (pré-condição do G3)

**Estado hoje (auditoria viva da Cristiane, 2026-10-23): a tabela
`integrations` tem ZERO linhas.** Sem um registo para a Athena, nada
do resto funciona: os endpoints de gestão resolvem a org **a partir
da linha da integração** (não há emissão sem dona), o backfill da
0011 insere zero chaves, e a Athena não tem identidade m2m. Este passo
cria esse registo — **documentado aqui, NÃO executado**: nem na Fase
2D, nem na revisão pré-G2. Não existe endpoint nem UI de criação de
integrações no Hub (a página `/integrations` é o catálogo de
serviços), por isso a criação é manual, pela Cristiane, no SQL editor
do projeto dedicado — o mesmo canal das migrations. O Cláudio não
executa nada no Hub.

Quando: **depois do G2** (0011 aplicada — antes disso a emissão por
endpoint devolve 501 e a chave teria de nascer legada, sem expiração
nem revogação: o contrário da C5) e **antes do smoke do G3**.

```sql
-- REGISTO INICIAL DA ATHENA — esboço para o gate G2.5.
-- NÃO EXECUTADO. Correr UMA vez, no SQL editor, já com a 0011 aplicada.
-- Colunas reais: supabase/migrations/0001_core.sql (public.integrations).
INSERT INTO public.integrations (org_id, name, provider, type, state, config, created_by)
VALUES (
  '<org_id>',        -- a única organização existente (auditoria 2026-10-23: 1 org)
  'Athena',          -- UNIQUE (org_id, name): um registo por cliente m2m
  'athena',          -- provider (texto livre, minúsculas como os exemplos da 0001)
  'api',             -- integration_type: 'mcp' | 'cli' | 'api' | 'webhook' | 'sdk'
  'connected',       -- tool_state: é o estado que a verificação e a gestão reconhecem
  '{}'::jsonb,       -- config SEM segredos e SEM apiKeyHash (ver "o que NÃO fazer")
  '<user_id>'        -- created_by: o utilizador owner que executa o registo
)
RETURNING id;        -- este id é o {integrationId} dos endpoints de gestão
```

Com o registo criado, a sequência (sem saltos) é:

1. **Cristiane** (sessão humana owner/admin no Hub) emite a chave:
   `POST /api/v1/integrations/{integrationId}/api-keys` com
   `label` identificativo (ex.: `Athena — produção`), TTL por omissão
   (90 dias) e segredo de assinatura ativo (omissão). **Scopes:
   `tools:read`, `jobs:read`, `jobs:write` — SEM `approvals:decide`**
   (decisão ratificada: a Athena nunca recebe esse scope; e, mesmo
   que o recebesse, a C4 impede qualquer chave de decidir aprovações).
   A resposta devolve **uma única vez**: a chave crua, o segredo de
   assinatura e o id da chave.
2. **Cristiane** regista o segredo no servidor do Hub:
   `HUB_SIGNING_SECRETS_JSON = { "<id da chave>": "<segredo>" }`
   (por desenho, a referência do segredo **é** o id da chave).
3. **Cristiane → Cláudio, por canal seguro** (nunca chat, nunca git,
   nunca logs): chave crua + segredo de assinatura + id da chave.
4. **Cláudio** (lado Athena): guarda os três valores no vault da
   Athena e configura o cliente para enviar `Authorization: Bearer`,
   `X-Key-Id`, `X-Request-Timestamp` e `X-Nonce` em cada pedido (a
   `X-Signature` entra no G4).
5. O smoke do G3 passa a incluir **esta** chave (além da descartável):
   `GET /api/v1/tools` → 200 limitado à org dela; nonce repetido →
   `401 REPLAY_DETECTED`.

O que **NÃO** fazer:

- **Não** preencher `integrations.config.apiKeyHash` para a Athena —
  isso registá-la-ia pelo processo legado, sem expiração, sem
  revogação imediata e com varredura em vez de lookup O(1).
- **Não** criar o registo antes do G2 (ver acima) nem "para adiantar".
- **Não** reutilizar este registo para outro cliente m2m futuro:
  um registo (e chaves próprias) por cliente.

### G3 — Validação pós-aplicação (somente leitura + smoke destrutivo-zero)
1. Estrutura: as duas tabelas existem; RLS ativa nas duas; **0 policies**
   em cada uma (é o desenho — policies aqui seriam um achado, não um
   requisito); o UNIQUE de `key_hash` existe.
2. Backfill: `SELECT count(*) FROM api_keys;` deve igualar o nº de
   integrações com `config ? 'apiKeyHash'` (provavelmente 0 hoje).
3. Suite completa da branch contra o código (os testes usam fakes — a
   validação viva é o smoke seguinte).
4. Smoke com chave de TESTE: emitir via endpoint (sessão owner) →
   autenticar um `GET /api/v1/tools` com ela (com `X-Request-Timestamp`
   e `X-Nonce`) → repetir o mesmo nonce (esperado: `401 REPLAY_DETECTED`)
   → revogar via endpoint → tentar outra vez (esperado: `401`). Apagar
   nada: a chave de teste fica revogada e auditada, como deve ser.
5. Registar o resultado do smoke no relatório da fase seguinte — sem
   smoke, a ativação não é declarada.

### G4 — A Athena passa a assinar (lado Cláudio + flag)
1. Cláudio implementa a assinatura no cliente Athena (string canónica
   byte-idêntica; o vetor da spec §2.4 reproduzido em teste unitário
   dos dois lados) e guarda chave + segredo no vault da Athena.
2. O segredo é registado no servidor do Hub em `HUB_SIGNING_SECRETS_JSON`
   com a referência = id da chave emitida para a Athena.
3. Janela de observação com a assinatura ainda opcional: pedidos sem
   `X-Signature` geram `auth.signature_missing` em `audit_logs` —
   quando esse registo parar, a Athena está a assinar tudo.
4. Ligar `HUB_REQUIRE_SIGNATURES=true`. A partir daqui, chave da tabela
   sem assinatura válida = 401.

### G5 — Fechar a transição (fase separada, não é esta)
`HUB_API_KEYS_LEGACY_FALLBACK=false` durante uma release; depois,
migration 0012 (futura) para remover `apiKeyHash`/`scopes` de
`integrations.config` e o caminho legado do código.

---

## 4. Rollback

Rollback **nunca é automático** e tem três níveis independentes —
usa-se o mais leve que resolver o problema:

### Nível 1 — Comportamento (variáveis de ambiente, sem tocar em código nem BD)
- Assinatura a bloquear pedidos legítimos → `HUB_REQUIRE_SIGNATURES`
  para `false`/ausente: volta a ser opcional (continua validada quando
  apresentada). Reverter depois de corrigir o lado que assina.
- Suspeita no caminho novo → **não** há flag que "desligue" a tabela
  para chaves nela emitidas (é deliberado: uma chave revogada não pode
  ressuscitar). O caminho de saída é o Nível 3, ou revogar as chaves
  afetadas e reemiti-las.

### Nível 2 — Código (reverter a branch/commits da Fase 2D)
A autenticação legada está intacta por desenho, portanto reverter o
código devolve exatamente o comportamento pré-2D — **para as chaves
legadas**. Chaves emitidas na tabela `api_keys` não existem no mundo
legado: se já houver chaves reais emitidas, o rollback de código tem de
ser acompanhado de reemissão manual dessas chaves pelo processo legado
documentado em `docs/ATHENA_INTEGRATION.md`, ou não se faz.

### Nível 3 — Base de dados (down-migration MANUAL, destrutiva, gate expresso)
```sql
-- DOWN da 0011 — MANUAL, nunca automático. Apaga nonces e chaves
-- emitidas (metadados incluídos). Antes de correr: exportar
-- `SELECT id, org_id, integration_id, label, scopes, created_at,
-- expires_at, revoked_at FROM public.api_keys;` para registo.
DROP TABLE IF EXISTS public.api_request_nonces;
DROP TABLE IF EXISTS public.api_keys;
```
Depois do drop, o código degrada sozinho e honestamente para o mundo
pré-0011 (autenticação legada; nonces em memória; gestão = 501) — é o
comportamento provado em testes para a ausência das tabelas.

---

## 5. Operação contínua

- **Limpeza de nonces:** as linhas expiram 600 s depois do pedido.
  Limpeza = `DELETE FROM api_request_nonces WHERE expires_at < now();`
  periodicamente. A disponibilidade de `pg_cron` no projeto **não está
  verificada** — alternativas: tarefa agendada externa a chamar uma
  rotina que use `cleanupExpiredNonces()` de `lib/api-signing.ts`, ou
  limpeza manual vigiada. Se a limpeza falhar, a tabela cresce devagar
  (≤ nº de pedidos em janela) e a contagem entra na auditoria periódica.
- **Expirações próximas:** a listagem de metadados marca
  `expiringSoon` (≤14 dias) — o operador roda ANTES de expirar
  (emitir com `replacesKeyId`, revogar a antiga), sem cortes.
- **Rotação do segredo de assinatura de uma chave existente:** gerar
  segredo novo, atualizar `HUB_SIGNING_SECRETS_JSON[<id da chave>]` no
  Hub e o vault da Athena na mesma janela, e confirmar com um pedido
  assinado. (A referência não muda; muda o valor nos dois cofres.)
