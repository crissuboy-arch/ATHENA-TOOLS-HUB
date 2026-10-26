# G3 — Plano de testes reais pós-migration 0011 (PREPARAÇÃO — NÃO EXECUTAR SEM AUTORIZAÇÃO)

**Estado:** documento de preparação, criado na fase "G3 — Preparação"
(24/10/2026). **O G3 operacional NÃO foi executado.** Nenhum teste
real correu contra a base viva, nenhuma chave foi emitida, nenhum
registo foi criado. Executar este plano exige **nova autorização
expressa da Cristiane**, passo a passo.

**Contexto que este plano assume (factos, não suposições):**
- G2 **concluído** (24/10/2026, atualização oficial dela): a 0011 está
  aplicada no Supabase oficial (`bvsvqueeihljwksemfmz`) — 27 tabelas,
  `api_keys` + `api_request_nonces` criadas, RLS ativa, zero policies
  (intencional), **zero chaves emitidas, zero integrações**.
- **Nenhum deploy foi feito.** O código que corre em produção NÃO é o
  da 2D/pré-G2. Por isso, o smoke abaixo **não pode correr contra a
  produção atual** — ver §1, pré-condição P0, que é uma decisão dela.

---

## 1. Pré-condições (todas têm de estar verdadeiras antes do passo T1)

| # | Pré-condição | Quem / como | Se faltar |
|---|---|---|---|
| P0 | **Onde corre o código novo, decidido e executado.** O código das branches 2D + pré-G2 (`feat/fase-2d-c3-c5` @ `0518d61` + `fix/fase-2d-pre-g2` @ `fc2a5b3`) tem de estar a correr no ambiente onde o smoke vai bater — seja um deploy de preview/staging, seja produção. **Isto é, por si só, uma decisão de deploy da Cristiane** e não está autorizada por este plano. | Cristiane autoriza; execução conforme o canal de deploy do projeto | **Não executar o smoke.** Testar contra o código antigo provaria zero sobre a 0011 |
| P1 | G2.5 executado por ela: registo inicial da Athena em `integrations` (ver `docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md` §G2.5), com `state='connected'`, `config='{}'` sem segredos. | Cristiane, SQL editor, UMA vez | Sem registo não há emissão por endpoint (a gestão resolve a org a partir da linha da integração) |
| P2 | Sessão humana owner/admin dela no Hub, na org única existente. | Cristiane | Sem sessão não há emissão (chaves nunca emitem chaves) |
| P3 | Relógio do cliente de teste sincronizado (a janela de timestamp é ±5 min). | Quem executa o smoke | Timestamps fora da janela dão 401 e confundem o diagnóstico |
| P4 | Canal seguro disponível para guardar a chave de teste (nunca chat, nunca git, nunca logs). | Cristiane | Sem canal, não emitir |

**O que o smoke NÃO precisa:** `HUB_REQUIRE_SIGNATURES=true` (isso é
G4). A assinatura é validada quando presente (C3-1) — o passo T4
testa-a com o segredo registado; sem segredo registado no servidor, o
passo T4 fica para depois do registo do segredo (ver §3, T4).

---

## 2. Formas seguras de executar os testes reais

1. **Um só artefacto de teste, claramente marcado.** Uma única chave
   de teste (`label` começado por `TESTE — G3 —`), emitida sob o
   registo da Athena (G2.5). **Nunca** usar uma futura chave de
   produção da Athena para o smoke — a chave de produção nasce depois,
   limpa, quando o G3 passar.
2. **Isolamento:** a base viva tem **uma única organização** — o teste
   corre nela, mas só toca nos seus próprios artefactos (a sua chave,
   os seus nonces). Não toca em dados de ferramentas, jobs ou
   aprovações de ninguém: o smoke usa `GET /api/v1/tools` (leitura) e
   nunca cria jobs, missões ou aprovações.
3. **Ordem imutável:** emitir → autenticar → assinar → repetir nonce
   → revogar → autenticar revogada. **Não saltar a revogação** nem
   deixar a chave de teste viva "para depois".
4. **Limpeza no fim (obrigatória):** a chave de teste fica **revogada**
   (não apagada — a revogação é o registo de auditoria; apagar
   destruiria a prova). Verificar que a autenticação com ela dá 401
   (passo T6). Os nonces expiram sozinhos em 600 s; não é preciso
   apagá-los. Se algum passo falhar a meio, a limpeza é sempre a
   revogação da chave de teste, seguida do registo do sucedido no
   relatório do G3.
5. **O que NUNCA fazer na base viva:** não apagar linhas de
   `api_keys`/`api_request_nonces`; não editar `integrations.config`
   à mão (nunca preencher `apiKeyHash` para a Athena — seria o caminho
   legado); não correr testes de carga; não partilhar a chave crua ou
   o segredo em chat, logs ou commits; não decidir aprovações com
   chave (a C4 bloqueia — e tentar seria o teste errado).

---

## 3. Procedimento ponta a ponta — passo a passo, com resultado esperado

Convenção: `BASE` = a origem onde o código novo está a correr (P0).
`KEY` = a chave crua da chave de teste (mostrada uma única vez na
emissão). `SECRET` = o segredo de assinatura devolvido na emissão.
Todos os pedidos m2m levam `Authorization: Bearer KEY`,
`X-Request-Timestamp` (unix, segundos) e `X-Nonce` (uuid novo por
pedido — exceto T5, onde se repete de propósito).

### T1 — Emissão da chave de TESTE
**Como:** sessão humana owner/admin dela →
`POST /api/v1/integrations/{integrationId}/api-keys` com
`label: "TESTE — G3 — smoke pós-0011"`, scopes
`tools:read`, `jobs:read`, `jobs:write` (**sem** `approvals:decide`),
sem `expiresInDays` (TTL por omissão: **90 dias**).
**PASS esperado:** `201`, resposta com `rawKey` (começa por
`hub_live_`), segredo (`hub_sign_…`) e `id` da chave — **uma única
vez**. A resposta NÃO contém o hash em claro legível? Contém
metadados; o hash nunca é exibido (a listagem é só de metadados).
**Guardar** `KEY`, `SECRET` e `id` no canal seguro (P4).
**FAIL se:** `501` (o código a correr ainda é o pré-0011 — voltar a
P0), `403` (sessão sem owner/admin), ou a chave voltar a aparecer
numa listagem posterior (nunca deve: exibição única).
**Depois disto:** registar `SECRET` no servidor do Hub em
`HUB_SIGNING_SECRETS_JSON` com a chave = `id` da chave (é o que
permite o passo T4). Sem este registo, T4 fica pendente — T2/T3/T5/T6
não dependem dele.

### T2 — Autenticação com a tabela `api_keys`
**Como:** `GET {BASE}/api/v1/tools?orgId={orgId}` com `Bearer KEY` +
timestamp + nonce novo.
**PASS esperado:** `200` e a lista contém **só** ferramentas da org
única (isolamento C1: 10 ferramentas do seed — contagem a confirmar
no momento, não presumida). A resposta prova, ao vivo, que o lookup
O(1) na tabela funciona e que a classificação de erros está certa
(é a prova viva pedida na revisão pré-G2: "chave válida da tabela
autentica").
**FAIL se:** `401` (chave não reconhecida — investigar: foi emitida
na base certa? o código a correr é o novo?), `500` (falha de infra —
nunca confundir com 401: 500 = transitório, não "chave inválida"),
`403` (org divergente — seria um achado de isolamento).

### T3 — Autenticação sem assinatura continua aceite (C3-1, pré-G4)
**Como:** repetir T2 **sem** `X-Signature` (é o que T2 já faz).
**PASS esperado:** `200` — a assinatura é opcional até ao G4, mas o
pedido fica registado em `audit_logs` como `auth.signature_missing`
(observável depois; não é preciso consultar agora).
**Nota:** este passo existe para provar que o G3 não parte o cliente
que ainda não assina — o que o G4 mudará.

### T4 — Assinatura HMAC-SHA256 validada (Opção A)
**Como:** construir a string canónica
`METHOD\nPATH+QUERY(ordenada)\nTIMESTAMP\nNONCE\nSHA256_HEX(corpo)`
e assinar com `SECRET` (HMAC-SHA256 hex); enviar o mesmo pedido de T2
acrescentado de `X-Key-Id: {id da chave}` e `X-Signature: {hmac}`.
**PASS esperado:** `200` com a assinatura verificada. Variante
negativa (fazer também): o mesmo pedido com **um byte da assinatura
alterado** → `401` genérico (sem distinguir "chave inválida" de
"assinatura inválida" — sem oráculo).
**Pré-condição:** `SECRET` registado no servidor (fim de T1). Sem
ele, o Hub não consegue validar → `401` esperado mas **não
conclusivo**; nesse caso T4 fica registado como pendente, não como
falha.
**FAIL se:** assinatura correta dá 401 (string canónica divergente
entre cliente e Hub — comparar byte a byte com o vetor da spec §2.4).

### T5 — Repetição de nonce bloqueada (anti-replay persistente)
**Como:** repetir **exatamente** o pedido de T2 (mesmo `X-Nonce`,
mesmo timestamp dentro da janela) — um reenvio integral.
**PASS esperado:** `401 REPLAY_DETECTED`. Isto prova o insert-first
persistente: a segunda tentativa embate na PK `(api_key_id, nonce)`.
**Variante:** repetir o nonce **depois de uma falha a jusante**
(ex.: um pedido que falhou por outro motivo) → continua
`REPLAY_DETECTED` — a falha não lava o nonce (prova pré-G2, agora ao
vivo).
**FAIL se:** o reenvio dá `200` (o anti-replay não está persistente —
achado crítico; parar aqui e não avançar para a ativação).

### T6 — Revogação imediata e autenticação revogada bloqueada
**Como:** sessão humana owner/admin →
`DELETE /api/v1/integrations/{integrationId}/api-keys/{keyId}`.
Depois, repetir T2 com `KEY` e nonce novo.
**PASS esperado:** revogação `200` (ou `204` conforme o contrato;
idempotente — revogar duas vezes não dá erro); o pedido seguinte dá
`401` — **e nunca** `200` pelo caminho legado (a revogada é decisiva:
o legado não a ressuscita — é o teste vivo da C5).
**Limpeza:** a chave fica revogada e auditada; nada a apagar. Registar
no relatório do G3: `id` da chave, hora da emissão, hora da
revogação, e o resultado de cada passo T1–T6.

### Critérios de fecho do G3
- **PASS total:** T1–T6 todos PASS → o G3 está validado; o próximo
  passo é o G4 (a Athena passa a assinar) com o lado do Cláudio.
- **Qualquer FAIL:** registar o passo, o código devolvido, e o que se
  observou; **não declarar a ativação**. Um 500 em qualquer passo é
  falha de infraestrutura a investigar, não "chave inválida".

---

## 4. O que este plano NÃO autoriza

- Não autoriza o deploy (P0 é decisão dela à parte).
- Não autoriza o G2.5 (registo da Athena — manual, por ela).
- Não autoriza a emissão da chave de produção da Athena.
- Não autoriza o G4 (assinatura obrigatória).
- Não autoriza testes de escrita fora dos passos acima, nem tocar em
  dados que não sejam os artefactos do próprio smoke.
