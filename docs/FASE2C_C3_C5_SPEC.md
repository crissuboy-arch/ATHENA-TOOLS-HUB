# FASE 2C — Especificação técnica C3 + C5 (SÓ ESPECIFICAÇÃO)

**Estado:** PROPOSTA para autorização futura. **Nada disto está implementado.**
**Data:** 2026-10-23 · **Branch de referência:** `feat/fase-2c-c6-tipos` (a partir de `33303bc`)
**Âmbito:** C3 = assinatura HMAC + anti-replay persistente (fecha **B2**);
C5 = tabela dedicada `api_keys` com expiração e revogação (fecha **B5** + **B6**).

> ⚠️ A migration 0011 esboçada no Anexo A é **PROPOSTA — NÃO APLICAR**.
> Não existe ficheiro de migration 0011 neste repo por esta fase; o SQL do
> anexo é texto de especificação, não um artefacto executável. Criar a
> migration exige autorização expressa separada; aplicá-la à BD viva é um
> gate adicional da Cristiane (SQL editor), como todas as anteriores.

---

## 1. Estado atual (evidência, código de hoje)

| Peça | Hoje | Ficheiro |
|---|---|---|
| Armazenamento da chave | Só o hash SHA-256, dentro de `integrations.config` (JSONB), junto de `scopes` | `lib/api-keys.ts:4-5,77-80` |
| Verificação | Varredura de **todas** as integrações `state='connected'` + comparação timing-safe em memória → custo cresce com o nº de integrações (B6) | `lib/api-keys.ts:77-103` |
| Legibilidade do hash | A policy SELECT de `integrations` (0002) deixa **qualquer membro da org, viewer incluído**, ler `config` — e portanto o `apiKeyHash` — via PostgREST (B5) | `0002_rls.sql` (loop `_rw_select`) |
| Anti-replay | `X-Request-Timestamp` (±300 s) + `X-Nonce` único, **sem assinatura**: o nonce não está ligado a método/path/corpo — um pedido capturado pode ser reenviado com corpo alterado e nonce fresco (B2) | `lib/api-keys.ts:29-46,123-149` |
| Store de nonces | `Map` **em memória, por instância**, TTL 10 min — multi-instância aceita o mesmo nonce noutra instância; restart apaga a proteção | `lib/api-keys.ts:37-50` |
| Expiração / revogação | **Inexistentes**: chaves não expiram, sem `last_used_at`, sem endpoint de emissão/revogação (processo manual por SQL) | `lib/api-keys.ts` (ausência) |
| Emissão | `generateApiKey()` existe; gravação é manual/documentada | `docs/ATHENA_INTEGRATION.md` |

Facto que simplifica o rollout: **o Hub não está em produção** (sem deploy
autorizado até hoje) e ainda não foi emitida nenhuma chave real para a
Athena — a mudança de contrato não tem clientes vivos para partir. Mesmo
assim, o contrato documental (`ATHENA_INTEGRATION.md`, `ATHENA_BRIDGE.md`,
`openapi.yaml`) tem de ser atualizado **na mesma alteração** que o código.

---

## 2. C3a — Assinatura HMAC dos pedidos machine-to-machine

### 2.1 O que se assina (string canónica)

Cada pedido Bearer passa a incluir `X-Signature`. A string canónica é
exatamente (LF = `\n`, sem newline final):

```
<METHOD>\n<PATH+QUERY>\n<X-Request-Timestamp>\n<X-Nonce>\n<SHA256_HEX(BODY)>
```

- `METHOD` em maiúsculas (`POST`, `GET`, …).
- `PATH+QUERY`: path absoluto começado por `/api/v1/…`; query string com
  parâmetros **ordenados por chave** e codificação RFC 3986 (a mesma que o
  cliente enviou — sem reordenar valores repetidos). Sem query → só o path.
- `X-Request-Timestamp`: os mesmos unix seconds já exigidos hoje.
- `X-Nonce`: o mesmo nonce já exigido hoje (UUID por pedido).
- `SHA256_HEX(BODY)`: hash hex minúsculo dos **bytes exatos** do corpo;
  corpo vazio → hash da string vazia
  (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

Assinatura: `X-Signature: <hex minúsculo de HMAC-SHA256(segredo, canónica)>`.
Comparação no servidor: `timingSafeEqual` (padrão já usado no repo).

Com isto, o nonce fica criptograficamente ligado a método+path+corpo+
timestamp: reenviar um pedido capturado com qualquer alteração invalida a
assinatura; reenviar sem alteração é apanhado pelo nonce persistente (§3).

### 2.2 O segredo de assinatura — decisão de desenho (DECISÃO DELA + CLÁUDIO)

O Hub guarda **apenas o hash** da chave Bearer — não pode recomputar um
HMAC cuja chave seja a chave crua. Duas opções:

| | **Opção A (recomendada)** — segredo de assinatura dedicado | **Opção B** — derivar do hash guardado |
|---|---|---|
| Desenho | Na emissão, geram-se **dois** segredos: a chave Bearer (`hub_live_…`) e um segredo de assinatura (`hub_sign_…`, 32 bytes). O segredo de assinatura fica no **cofre** dos dois lados (vault Athena / vault do Hub); a BD guarda só uma **referência** (`signing_secret_ref`), nunca o valor | Cliente e servidor usam `SHA256(chave_crua)` — que é exatamente o hash já guardado — como chave HMAC. Zero armazenamento novo |
| Se a BD vazar | Hash da Bearer continua inútil para autenticar; sem o segredo do cofre não há assinaturas válidas | **Quem tiver o hash guardado consegue assinar** — degrada a garantia face a hoje |
| Complexidade | Emissão/rotação gerem 2 segredos; Cláudio guarda 2 valores no vault | Mínima; 1 segredo só |
| Veredicto | Correta para produção | Aceitável apenas como passo intermédio documentado |

**Recomendação:** Opção A. A rotação faz-se com janela de graça: a linha da
chave aceita `signing_secret_ref` atual + anterior durante a janela
(configurável, sugestão 24 h), identificadas por um cabeçalho
`X-Key-Id: <id público da chave>` (ver §4 — a tabela `api_keys` dá a cada
chave um id não-secreto, o que também resolve a ambiguidade de "que chave
assinou" sem varreduras).

### 2.3 Compatibilidade e rollout

1. **Fase C3-1 (código):** o servidor aceita pedidos com e sem
   `X-Signature`; quando presente, valida (assinatura errada → 401);
   quando ausente, regista em `audit_logs` (`auth.signature_missing`).
   Nonce/timestamp mantêm-se obrigatórios como hoje.
2. **Fase C3-2 (contrato):** a Athena (Cláudio) passa a assinar todos os
   pedidos; docs e OpenAPI atualizados na mesma entrega.
3. **Fase C3-3 (fecho):** flag `HUB_REQUIRE_SIGNATURES=true` torna a
   assinatura obrigatória para chaves `api_keys` (as legadas em
   `integrations.config` são migradas antes — §4.4 — por isso não há
   caminho sem assinatura no fim).

Falhas de assinatura devolvem **401 genérico** (mesmo corpo das outras
falhas de auth — sem oráculo que distinga "chave desconhecida" de
"assinatura inválida").

### 2.4 Vetor de teste (interoperabilidade — valores de EXEMPLO)

Segredo de assinatura (fictício): `EXEMPLO-segredo-de-assinatura-nao-usar`
Pedido: `POST /api/v1/athena/missions`, timestamp `1760000000`,
nonce `11111111-2222-4333-8444-555555555555`, corpo:

```
{"mission_id":"00000000-0000-4000-8000-000000000000","tool_slug":"vectorcraft","params":{}}
```

- `SHA256(corpo)` = `66732d18485654563c5be90b87ea028536bf7ccc78f4a910321cf810a8844b86`
- String canónica = `POST\n/api/v1/athena/missions\n1760000000\n11111111-2222-4333-8444-555555555555\n66732d18485654563c5be90b87ea028536bf7ccc78f4a910321cf810a8844b86`
- `X-Signature` esperado = `2dd81aecd970b396cfa7c49e24b23727c128045fb6dfb2abc203dd0adbb7a187`

A implementação (dos dois lados) tem de reproduzir este vetor num teste
unitário antes de qualquer teste ao vivo — é a prova de que a
canonicalização é byte-idêntica.

---

## 3. C3b — Anti-replay persistente

### 3.1 Onde vivem os nonces

Nova tabela `api_request_nonces` (esboço no Anexo A), escrita **antes** de
processar o pedido:

```sql
INSERT INTO public.api_request_nonces (api_key_id, nonce, request_ts)
VALUES ($1, $2, $3)
-- conflito na PK (api_key_id, nonce) → 401 REPLAY_DETECTED
```

- **Insert-first**: a unicidade é imposta pela BD, atomicamente, para todas
  as instâncias — substitui o `Map` em memória de `lib/api-keys.ts:37-50`.
- **Janela**: mantém-se ±300 s sobre `X-Request-Timestamp` (validada antes
  do insert, como hoje).
- **TTL/limpeza**: linha expira em `request_ts + 600 s` (2× a janela — um
  nonce nunca pode voltar a ser aceite depois disso, porque o timestamp
  estaria fora da janela). Limpeza por job periódico
  `DELETE … WHERE expires_at < now()`; a disponibilidade de `pg_cron` no
  projeto **não está verificada** — alternativas: rotina no arranque do
  processo + limpeza preguiçosa probabilística no insert (1 em 100), ou
  tarefa agendada externa. A tabela é pequena por desenho (≤ nº de pedidos
  em 10 min).
- **Âmbito**: o nonce é único **por chave** (`api_key_id`), não global —
  duas integrações distintas podem usar o mesmo nonce sem colisão (mesma
  semântica de hoje, onde o `Map` é agrupado por hash da chave).

### 3.2 Ordem de validação num pedido Bearer (alvo)

1. Lookup da chave (§4.3) → 401 genérico se desconhecida/revogada/expirada.
2. Timestamp dentro de ±300 s → senão 401.
3. Assinatura HMAC válida (§2, quando exigida) → senão 401.
4. Insert do nonce → conflito = 401 `REPLAY_DETECTED`.
5. Scope e `resolveOrgScope` (inalterados — C1 da Fase 2A intacta).

Aprovações continuam **só humanas** (C4 da Fase 2B): nenhuma chave, com ou
sem assinatura, decide aprovações.

---

## 4. C5 — Tabela dedicada `api_keys` (fecha B5 + B6)

### 4.1 Desenho da tabela (esboço completo no Anexo A)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | É o `X-Key-Id` público — identifica a chave sem segredo |
| `org_id` | uuid FK → organizations, CASCADE | Isolamento por org (C1) |
| `integration_id` | uuid FK → integrations, SET NULL | Integração dona da chave (a Athena = 1 integração) |
| `label` | text NOT NULL | Nome legível ("Athena — produção") |
| `key_hash` | text NOT NULL, **UNIQUE** | SHA-256 hex da chave crua — **nunca** a chave |
| `scopes` | text[] NOT NULL DEFAULT '{}' | Subconjunto dos 4 scopes atuais |
| `signing_secret_ref` | text NULL | Referência para o cofre (Opção A, §2.2) — nunca o segredo |
| `created_by` | uuid NULL | Quem emitiu |
| `created_at` | timestamptz NOT NULL | |
| `expires_at` | timestamptz NULL | NULL = sem expiração (desaconselhado; ver §4.5) |
| `last_used_at` | timestamptz NULL | Atualizado com throttle (§4.3) |
| `revoked_at` | timestamptz NULL | NULL = ativa; preenchido = revogada (revogação é imediata e irreversível; rotação = emitir nova) |
| `replaced_by_id` | uuid FK → api_keys, SET NULL | Linhagem de rotação (auditoria) |

Índices: UNIQUE em `key_hash` (o lookup), índice em `org_id`, índice
parcial em `expires_at` para o relatório de expirações próximas.

### 4.2 Quem lê o quê (fecha B5)

- **RLS ativa com ZERO policies para `authenticated`/`anon`** (fail-closed,
  o padrão do repo): nenhum membro de org — nem owner — lê `api_keys` via
  PostgREST. O hash sai de `integrations.config`, onde hoje qualquer
  viewer o lê.
- O acesso é exclusivamente **service_role** no servidor (rotas de gestão
  §4.5 + `verifyApiKey`), que já é o modelo de toda a API v1.
- Se um dia a UI precisar de listar chaves, expõe **metadados sem hash**
  (id, label, scopes, datas) por uma rota de servidor que seleciona
  colunas explicitamente — nunca `SELECT *` sobre a tabela.

### 4.3 Verificação O(1) (fecha B6)

```
verifyApiKey(rawKey):
  hash = sha256(rawKey)
  row = SELECT id, org_id, scopes, expires_at, revoked_at
        FROM api_keys WHERE key_hash = hash        -- índice UNIQUE
  se !row | revoked_at != null | expirada → null (401 genérico)
  timingSafeEqual(row.key_hash, hash)              -- redundante c/ índice, mantido por defesa em profundidade
  last_used_at = now() SE last_used_at < now() - 60s   -- throttle: no máx. 1 escrita/min por chave
  → { orgId, scopes, apiKeyId }
```

Substitui a varredura de `lib/api-keys.ts:77-103`. O custo passa a ser
constante e independente do nº de integrações.

### 4.4 Migração de dados (dentro da proposta 0011)

1. `INSERT INTO api_keys (org_id, integration_id, label, key_hash, scopes, created_by, created_at)
   SELECT org_id, id, name, config->>'apiKeyHash', config->'scopes', created_by, created_at
   FROM integrations WHERE config ? 'apiKeyHash'` — as chaves existentes
   (se alguma tiver sido emitida manualmente até lá) sobrevivem sem
   trocar o valor cru.
2. Transição em código: `verifyApiKey` consulta `api_keys` primeiro e,
   atrás de flag (`HUB_API_KEYS_LEGACY_FALLBACK`), cai para a leitura
   legada de `integrations.config` durante **uma** release.
3. Remoção do campo legado e da flag: migration futura (0012, fora desta
   especificação) + limpeza de `config`. **Não** faz parte da 0011.

### 4.5 Expiração, revogação e emissão por endpoint (fecha o resto de B6)

- **Emissão**: `POST /api/v1/integrations/{integrationId}/api-keys`
  (sessão owner/admin da org; m2m **não** emite chaves). Gera
  `hub_live_…` (+ segredo de assinatura, se Opção A), grava hash +
  metadados, devolve o valor cru **uma única vez** na resposta; regista
  `audit_logs` (`api_key.issued`, sem o valor).
- **Revogação**: `DELETE /api/v1/integrations/{integrationId}/api-keys/{keyId}`
  (sessão owner/admin) → `revoked_at = now()`; efeito imediato (o lookup
  filtra `revoked_at IS NULL`); `audit_logs` (`api_key.revoked`).
- **Rotação**: emitir nova + revogar a antiga; para rotação sem corte,
  emitir a nova e deixar a antiga expirar por `expires_at` curto
  (sobreposição controlada) — `replaced_by_id` liga as duas.
- **Expiração**: `expires_at` definido na emissão; **default proposto:
  90 dias** para chaves de integração m2m (decisão dela). Sem renovação
  silenciosa: expirar = 401 genérico + `audit_logs` na primeira tentativa
  pós-expiração. Listagem de chaves a expirar em ≤14 dias fica disponível
  na rota de metadados para o operador agir antes.
- Os **4 scopes atuais mantêm-se** (`tools:read`, `jobs:read`,
  `jobs:write`, `approvals:decide`) e a regra C4 mantém-se: scope de
  aprovação em chave m2m **não** decide aprovações (decisão é só humana).

---

## 5. Plano de aplicação por gates (quando for autorizado)

| Gate | Ação | Quem autoriza/executa |
|---|---|---|
| G0 | Autorizar **criar** o ficheiro `0011_api_keys.sql` a partir do Anexo A | Cristiane (autorização expressa de migration — separada) |
| G1 | Implementar código (C3 + C5) em branch isolada, com testes: vetor HMAC §2.4, replay multi-instância simulado (store partilhado), lookup O(1), expiração/revogação, negativos de RLS da tabela nova em `verify_rls.sql` estendido | Cristiane autoriza a fase; execução Muse |
| G2 | **Aplicar** a 0011 na BD viva (SQL editor) | Cristiane executa (ou autoriza expressamente) |
| G3 | Validação pós-aplicação: scripts de auditoria + suite completa + smoke de auth com chave de teste emitida e revogada | Muse + Cristiane |
| G4 | Athena passa a assinar (lado Cláudio) → ligar `HUB_REQUIRE_SIGNATURES` | Cláudio implementa; Cristiane autoriza o fecho |
| G5 | Remover fallback legado (migration 0012 futura) | Fase separada |

Nenhum destes gates está autorizado por esta especificação.

---

## 6. Riscos e dependências

### Riscos técnicos
- **Canonicalização divergente** entre Hub e Athena (ordenação da query,
  bytes do corpo, codificação) → 401 em massa. Mitigação: vetor de teste
  §2.4 reproduzido em testes unitários **dos dois lados** antes do vivo.
- **Relógios dessincronizados** (janela ±300 s): mitigação = NTP nos dois
  lados; a janela atual já pressupõe isto.
- **Crescimento de `api_request_nonces`**: mitigado por TTL de 600 s +
  limpeza (§3.1); se a limpeza falhar silenciosamente, a tabela cresce —
  monitorizar contagem na auditoria periódica.
- **Opção B de assinatura** (§2.2) degrada a garantia sob fuga da BD —
  fica registado como risco aceite **se** for a escolhida.
- **Transição dual-read** (§4.4): risco de uma chave legada ser aceite
  depois de revogada na tabela nova — mitigação: a revogação na transição
  escreve nos dois sítios; o fallback vive uma release apenas.
- **`pg_cron` não verificado** no projeto Supabase: a limpeza de nonces
  não pode depender dele sem confirmação (alternativas em §3.1).

### Depende da Cristiane
1. Autorizar G0 (criar a migration 0011) e, depois, G2 (aplicá-la).
2. Decidir a **Opção A vs B** do segredo de assinatura (§2.2) e o
   **TTL default** das chaves (§4.5).
3. Guardar o segredo de assinatura do lado do Hub no cofre acordado
   (nunca no repo/BD).

### Depende do Cláudio (lado Athena — repo ATHENA intocado por esta spec)
1. Implementar a assinatura no cliente Athena (string canónica
   byte-idêntica + vetor §2.4 em teste).
2. Guardar chave + segredo de assinatura no vault da Athena; suportar
   rotação com dois segredos durante a janela de graça.
3. Continuar a enviar `X-Nonce`/`X-Request-Timestamp` (já é o contrato
   atual) e passar a enviar `X-Signature`/`X-Key-Id`.

### Não depende de ninguém / já feito
C6 (tipos) está implementado nesta branch; a autenticação atual funciona
para o caminho feliz (Fase 1); aprovações humanas já estão fechadas em
código (C4/Fase 2B).

---

## Anexo A — Esboço SQL da migration 0011

> # ⚠️ PROPOSTA — NÃO APLICAR ⚠️
> Texto de especificação. **Não** é um ficheiro de migration, **não** foi
> executado, **não** deve ser colado no SQL editor. A versão executável,
> se autorizada (gate G0), será criada como
> `supabase/migrations/0011_api_keys.sql` numa fase própria.

```sql
-- PROPOSTA 0011 (NÃO APLICAR): api_keys + api_request_nonces
CREATE TABLE IF NOT EXISTS public.api_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  integration_id    uuid REFERENCES public.integrations (id) ON DELETE SET NULL,
  label             text NOT NULL,
  key_hash          text NOT NULL UNIQUE,        -- SHA-256 hex; NUNCA a chave crua
  scopes            text[] NOT NULL DEFAULT '{}',
  signing_secret_ref text,                       -- referência p/ o cofre; NUNCA o segredo
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  replaced_by_id    uuid REFERENCES public.api_keys (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (org_id);
-- lookup é pelo UNIQUE(key_hash); expirações próximas:
CREATE INDEX IF NOT EXISTS api_keys_expires_idx
  ON public.api_keys (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.api_request_nonces (
  api_key_id  uuid NOT NULL REFERENCES public.api_keys (id) ON DELETE CASCADE,
  nonce       text NOT NULL,
  request_ts  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, nonce)
);
CREATE INDEX IF NOT EXISTS api_request_nonces_expires_idx
  ON public.api_request_nonces (expires_at);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_nonces ENABLE ROW LEVEL SECURITY;
-- ZERO policies para authenticated/anon de propósito (fail-closed):
-- o hash de uma credencial não é legível por nenhum membro via PostgREST.
-- Acesso apenas via service_role no servidor (modelo de toda a API v1).

-- Backfill das chaves legadas em integrations.config (se existirem):
INSERT INTO public.api_keys (org_id, integration_id, label, key_hash, scopes, created_by, created_at)
SELECT org_id, id, name, config ->> 'apiKeyHash',
       COALESCE(ARRAY(SELECT jsonb_array_elements_text(config -> 'scopes')), '{}'),
       created_by, created_at
FROM public.integrations
WHERE config ? 'apiKeyHash'
ON CONFLICT (key_hash) DO NOTHING;
```

## Anexo B — O que esta especificação NÃO faz

- Não implementa C3 nem C5 (zero alterações em `lib/api-keys.ts`,
  `lib/api-auth.ts` ou rotas).
- Não cria nem aplica a migration 0011 (o Anexo A é texto, não ficheiro
  de migration).
- Não emite, revoga ou roda credencial alguma; não toca dados reais.
- Não altera ATHENA, Cris OS, NEXORA nem qualquer outro produto.
