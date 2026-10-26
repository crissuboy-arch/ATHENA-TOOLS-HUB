# Contrato operacional — Ligação ATHENA CONTROL → ATHENA TOOLS HUB

**Estado:** rascunho preparado na fase "G3 — Preparação" (24/10/2026)
**para revisão da Cristiane. NÃO ENVIAR ao Cláudio sem autorização
dela — o canal de entrega é dela.** Este documento é o que o Cláudio
usará para implementar o lado Athena; não substitui o contrato técnico
(`docs/ATHENA_INTEGRATION.md`, `openapi.yaml`) nem o plano de migração
(`docs/FASE2D_MIGRATION_ROLLBACK_PLAN.md`).

**Contexto em 24/10/2026:** G2 concluído (migration 0011 aplicada no
Supabase oficial — 27 tabelas; `api_keys` + `api_request_nonces`
criadas; zero chaves emitidas; zero integrações; **nenhum deploy**).
O G3 (validação real) e o G2.5 (registo inicial da Athena) estão por
fazer. Nada neste documento declara a ligação concluída — isso exige
teste real ponta a ponta (plano em `docs/G3_TEST_PLAN.md`).

---

## 1. Arquitetura oficial — cada produto na sua responsabilidade

| Produto | Papel | NÃO faz |
|---|---|---|
| **ATHENA CONTROL** | Orquestrador central. Decide, coordena e acompanha. É quem chama o Tools Hub. | Não executa ferramentas; não guarda catálogo |
| **TOOLS HUB** | Catálogo e execução de ferramentas. Recebe missões, cria jobs, expõe estado. | Não aprova nada sozinho; não decide publicação nem gasto |
| **CRIS OS** | Componente de execução/aprovação (o seu âmbito próprio). | Não duplica o catálogo do Hub nem o CRM |
| **NEXORA** | CRM e fonte dos dados comerciais. | Não é catálogo de ferramentas nem executor |

Regra transversal: **nenhum componente duplica a lógica de outro.**
Aprovações são sempre humanas (ver §6) — nenhum destes produtos
aprova por máquina.

## 2. Como a Athena consome o Hub — polling, sem callbacks

- A Athena **não recebe callbacks** do Hub (o Hub devolve 501 nesse
  desenho por decisão). O cliente Athena faz **polling**:
  `POST /api/v1/athena/missions` para criar, e
  `GET /api/v1/athena/missions/{id}` para acompanhar o estado até ao
  estado terminal.
- Criação é **idempotente**: reenviar o mesmo `mission_id` devolve o
  job original (`200` + `deduplicated: true`); a primeira vez dá
  `201`. O `mission_id` é preservado como `idempotencyKey` do job.
- Se a missão exige aprovação humana, o job fica `PENDING_APPROVAL`
  e a resposta aponta o endpoint de decisão — **a decisão é sempre
  humana** (§6).
- Outros endpoints úteis: `GET /api/v1/tools` (catálogo, filtrado
  pela org da chave), `GET /api/v1/jobs` / `GET /api/v1/jobs/{id}` /
  `GET /api/v1/jobs/{id}/events` / `GET /api/v1/jobs/{id}/assets`,
  `POST /api/v1/jobs/{id}/cancel`, `GET /api/v1/approvals` (só
  leitura — ver §6), `GET /api/v1/automations`.
- **Sem execução real de ferramentas nesta fase:** os executores do
  catálogo estão registados mas sem execução real (o Hub devolve o
  estado honesto de cada ferramenta). O G3 valida a **ligação**; a
  primeira execução real é fase posterior, com autorização própria.

## 3. Autenticação — Bearer + HMAC (Opção A)

- Cada pedido m2m leva:
  `Authorization: Bearer <chave>` ·
  `X-Key-Id: <id da chave>` ·
  `X-Request-Timestamp: <unix, segundos>` (janela ±5 min) ·
  `X-Nonce: <uuid único por pedido>`.
- **HMAC-SHA256 (Opção A — segredo dedicado):** a Athena assina cada
  pedido com um segredo **distinto da chave Bearer**. String canónica:
  `METHOD\nPATH+QUERY(ordenada)\nTIMESTAMP\nNONCE\nSHA256_HEX(corpo)`,
  assinatura em `X-Signature` (hex minúsculo).
  - **Até ao G4, a assinatura é opcional mas sempre validada quando
    presente** (C3-1). Pedidos sem assinatura de uma chave com
    segredo ficam registados no Hub como `auth.signature_missing`
    (observável, para confirmar que a Athena está a assinar tudo
    antes de ligar a obrigatoriedade).
  - **No G4, a assinatura passa a obrigatória**
    (`HUB_REQUIRE_SIGNATURES=true` no Hub): chave da tabela sem
    assinatura válida = 401.
- O vetor de interoperabilidade da especificação (spec §2.4) deve ser
  reproduzido em teste unitário **dos dois lados** antes do G4 — é a
  prova de que a string canónica é byte-idêntica.
- Segredos: a chave crua e o segredo de assinatura são entregues
  **uma única vez**, por canal seguro, e guardados no **vault da
  Athena**. Nunca em chat, logs ou git. O Hub guarda só o hash da
  chave e a referência do segredo (nunca os valores).

## 4. A chave futura da Athena — escopos exatos

A chave a emitir para a Athena (após o G2.5) tem **apenas**:

- `tools:read`
- `jobs:read`
- `jobs:write`

**NUNCA `approvals:decide`.** (Decisão ratificada; e mesmo que o
scope fosse concedido por engano, a C4 do Hub impede qualquer chave
de decidir aprovações — ver §6.)

Outros parâmetros da chave: validade por omissão **90 dias** (a
emissão pode definir outro TTL entre 1 e 3650 dias); rotação sem
cortar a antiga (`replacesKeyId`); revogação imediata e idempotente.

## 5. Tratamento de erros — o que cada código significa no cliente Athena

| Código | Significado | O cliente deve |
|---|---|---|
| `200` / `201` | OK / missão aceite | Continuar; `201` = primeira vez, `200` + `deduplicated: true` = reenvio idempotente |
| `400` | Payload inválido | Corrigir o pedido; não repetir igual |
| `401` genérico | Chave inválida/inativa, assinatura inválida/ausente, ou timestamp fora da janela | **Não repetir em loop.** Verificar credencial e relógio; se persistir, alertar o operador |
| `401 REPLAY_DETECTED` | Nonce já utilizado | Gerar nonce novo; nunca reutilizar nonces |
| `403` | Scope insuficiente ou org divergente | Não tentar outra org; verificar scopes da chave |
| `404` | Recurso inexistente (ou de outra org — indistinguível por desenho) | Tratar como inexistente |
| `409` | Conflito (ex.: `requires_human_approval` diverge do contrato da ferramenta) | Não ajustar em silêncio; resolver a divergência |
| `429` | Rate limit (120 req / 60 s por identidade) | Respeitar `Retry-After`; backoff |
| `500` | **Falha transitória de infraestrutura** (ex.: BD indisponível) | **Repetir com backoff** (com nonce novo — o nonce do pedido falhado está consumido); **nunca interpretar como "chave inválida"** |
| `501` | Funcionalidade não disponível (ex.: gestão de chaves antes da 0011; callbacks) | Não insistir; é estado honesto, não erro transitório |
| `503` | Ferramenta não configurada para execução | Informar; não é falha de autenticação |

Regra de ouro para o cliente: **500 ≠ 401.** Um 500 diz "tenta mais
tarde"; um 401 diz "a tua credencial ou assinatura está errada".
Confundi-los é o erro que este contrato existe para evitar.

## 6. Aprovações — exclusivamente humanas, sempre

- Decidir uma aprovação (`POST /api/v1/approvals/{id}/decision`)
  exige **sessão humana owner/admin** no Hub. Qualquer chave de API
  — mesmo com `approvals:decide` — recebe `403` em código (C4).
- A Athena **consulta** a fila (`GET /api/v1/approvals`) mas **nunca
  decide**. O fluxo é: Hub marca `PENDING_APPROVAL` → humano decide
  no Hub (ou no Cris OS, no seu âmbito) → Athena acompanha por
  polling até ao estado terminal.
- O Cris OS mantém as suas responsabilidades de execução/aprovação
  no seu âmbito — o Hub não as duplica e a Athena não as contorna.

## 7. O que depende de cada lado

| Passo | De quem | Estado |
|---|---|---|
| G2 — aplicar a 0011 | Cristiane (via ChatGPT, 24/10) | **Concluído** |
| G2.5 — registo inicial da Athena em `integrations` | Cristiane, SQL editor manual | **Por fazer** |
| Emissão da chave da Athena (endpoint, sessão owner/admin) | Cristiane | **Por fazer** (após G2.5) |
| Registo do segredo no servidor do Hub (`HUB_SIGNING_SECRETS_JSON`) | Cristiane | **Por fazer** |
| Entrega da chave + segredo + id por canal seguro | Cristiane → Cláudio | **Por fazer** |
| Guardar credenciais no vault da Athena | Cláudio | **Por fazer** |
| Cliente Athena: Bearer + timestamp + nonce + polling | Cláudio | **Por fazer** |
| Cliente Athena: assinatura HMAC (G4) | Cláudio | **Por fazer** (após G3) |
| G3 — smoke real ponta a ponta | Cristiane autoriza; execução conforme `docs/G3_TEST_PLAN.md` | **Por autorizar** |
| G4 — assinatura obrigatória | Cristiane (flag) + Cláudio (cliente a assinar tudo) | **Por fazer** |

## 8. Limites deste contrato

- Não cobre execução real de ferramentas (fase posterior).
- Não cobre publicação, gasto, nem qualquer ação fora do Hub.
- Não altera ATHENA, Cris OS ou NEXORA — cada produto mantém o seu
  âmbito; este documento só descreve a fronteira Hub↔Athena.
- Qualquer mudança a escopos, à obrigatoriedade da assinatura ou ao
  polling exige nova revisão — não se assume nada em silêncio.
