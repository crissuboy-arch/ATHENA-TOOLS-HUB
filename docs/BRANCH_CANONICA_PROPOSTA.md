# PROPOSTA — Branch principal canónica do Tools Hub (SÓ PROPOSTA)

**Estado:** 26/10/2026 · **Branch desta preparação:**
`feat/opcao-a-g3-preparacao` (local, sem push).
**Nenhuma alteração de branch default foi feita aqui.** Mudar o default
é uma ação de settings no GitHub, da proprietária (ou de quem ela
mandar), e exige autorização específica dela — que NÃO foi dada nesta
missão. Este documento é a análise + a recomendação + os passos exatos
para quando ela autorizar.

## 1. Estado atual (factos, verificados no clone)

- **O repo NÃO tem `main`.** O default remoto, segundo a auditoria de
  26/10/2026, é `feat/mvp-foundation` (@ `fa92252`) — confirmar em
  GitHub → Settings → Branches antes de qualquer mudança (o clone
  local não regista `origin/HEAD`, por isso o default não é provado
  a partir daqui).
- **Não há `main` local nem remota** (a `main` órfã referida noutros
  relatórios é do repo ATHENA, não deste).
- **Linhas vivas (todas sem `main`, todas por reconciliar até hoje):**

| Branch | Conteúdo | Estado |
|---|---|---|
| `feat/mvp-foundation` @ `fa92252` | MVP: catálogo 10 tools, RLS, dashboard | Default atual; código mais antigo da cadeia |
| `fix/fase-2d-pre-g2` @ `fc2a5b3` | Maquinário G2 (0011, HMAC, anti-replay) + gate G2.5 | Ancestral da linha login (provado por `merge-base --is-ancestor`) |
| `fix/login-melhorias` @ `5e30bd7` | Linha login: correções de callback/erros + modo só-Preview temporário | Base da discovery; 568 testes na altura |
| `feat/athena-connect-discovery` @ `6a9bc60` | Discovery Athena + permissões fail-closed + docs de integração/decisão | **No GitHub** (push autorizado 26/10); 592 testes |
| `docs/fase-g3-preparacao` @ `062c2ac` | SÓ documentos: plano G3 (T1–T6) + contrato operacional + adenda G2 | Docs reconciliados nesta preparação; código da linha antiga |
| `feat/opcao-a-g3-preparacao` (esta) | Discovery + docs G3 + migration 0012 PREPARADA + gate ligado | **Local, sem push**; 611 testes |

## 2. Recomendação

**Tornar canónica a linha desta preparação** — ou seja, a branch que
une discovery + G3 + Opção A — e dar-lhe o nome convencional `main`.

**Opção recomendada (A): criar `main` a partir desta branch.**

- Porquê `main` e não manter o nome comprido: o nome canónico deve ser
  óbvio para quem chega (Cláudio incluído), para o Vercel e para
  ferramentas que assumem `main` por omissão. O nome da branch de
  trabalho (`feat/opcao-a-g3-preparacao`) continua no histórico como
  origem da `main`.
- Porquê esta branch e não a discovery: é a única que contém TUDO —
  código discovery + documentos G3 + preparação Opção A + gate — sem
  perder trabalho de nenhuma linha.

**Opção alternativa (B): definir o default para
`feat/opcao-a-g3-preparacao` como está.** Menos passos, mas o nome
não-convencional perpetua a confusão de branches. Só vale se ela
preferir não criar `main` agora.

**Não recomendado:** manter `feat/mvp-foundation` como default. É o
código mais antigo da cadeia (pré-G2, pré-login, pré-discovery) e
obriga quem clona a adivinhar qual branch está atual — foi exatamente
o que gerou as linhas divergentes.

## 3. Passos exatos QUANDO ela autorizar (nada disto executado aqui)

Autorização necessária (específica, por escrito): push da branch de
preparação + criação da `main` + mudança do default no GitHub. Sem ela,
parar aqui.

1. **Rever esta branch** (diff final + suite 611/611 + typecheck +
   lint) e confirmar que é esta a linha a tornar canónica.
2. **Push da branch de preparação** (só então):
   `git push origin feat/opcao-a-g3-preparacao`.
3. **Criar a `main` a partir dela** (sem merge em mais nada):
   `git push origin feat/opcao-a-g3-preparacao:main` — ou, se ela
   preferir, criar a `main` na UI do GitHub a partir da branch.
4. **Mudar o default no GitHub:** Settings → Branches → Default
   branch → `main`. (Só quem tem admin no repo consegue; não é uma
   operação git.)
5. **Verificar o Vercel ANTES de considerar concluído:** confirmar em
   que branch o projeto `athena-tools-hub` faz deploy de produção
   (a configuração de Production Branch do projeto). Se apontar para
   o default antigo, mudar o default pode mudar o que vai para
   produção no próximo push — **verificar primeiro, e NÃO fazer
   deploy nesta operação** (deploy continua a exigir autorização
   própria).
6. **Atualizar referências:** procurar `feat/mvp-foundation` e
   `feat/athena-connect-discovery` como "branch atual" nos docs e
   corrigir para `main` (o histórico das branches mantém-se; só a
   referência de "atual" muda).
7. **Manter as branches antigas** (não apagar `feat/mvp-foundation`,
   `fix/login-melhorias`, `feat/athena-connect-discovery` nem
   `docs/fase-g3-preparacao`) até a `main` estar confirmada a correr
   — apagar é irreversível sem o SHA guardado, e os SHAs estão
   registados neste documento (§1) e no relatório de preparação.
8. **Verificação final:** `git ls-remote origin main` = SHA da branch
   de preparação; default no GitHub = `main`; nenhum deploy
   desencadeado por esta operação (se o Vercel auto-deploy estiver
   ligado à `main`, a criação da `main` pode disparar um deploy —
   confirmar o comportamento do projeto ANTES do passo 3; se disparar,
   a operação de tornar canónica passa a incluir um deploy e precisa
   de autorização de deploy à parte).

## 4. O que a branch canónica NÃO significa

- **Canónico ≠ deployed.** Tornar uma branch default não publica nada:
  nenhum deploy acontece por mudar o default, exceto o caso do passo
  8 acima (a confirmar). Produção continua a exigir autorização.
- **Canónico ≠ G3 concluído.** O G3 (T1–T7 ao vivo) continua pendente
  de T4, login definitivo, chave da Athena, 0012 aplicada e agente
  vinculado — a branch canónica apenas organiza o código.
- **Canónico ≠ fim das branches de trabalho.** Trabalho futuro continua
  em branches próprias, com merge só autorizado caso a caso.
