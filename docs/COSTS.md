# COSTS — custos honestos do ATHENA TOOLS HUB

> Regra: nenhum número inventado. Limites abaixo verificados em 2026-10-18
> contra fontes públicas (páginas oficiais de preços + agregadores revistos
> em jul–out/2026). O **dashboard de cada serviço é autoritativo** — se um
> número aqui divergir do dashboard, vale o dashboard. Itens por confirmar
> estão marcados **a confirmar**.

---

## 1. Grátis hoje ($0/mês)

### Vercel — plano Hobby ($0)

| Recurso | Limite Hobby | Se bater no limite |
|---|---|---|
| Transferência de dados | 100 GB/mês | Projeto pausa até ao próximo ciclo (sem cobrança) |
| Function invocations | ~1M/mês | idem |
| Build execution | 6.000 min/mês | Builds em fila/rejeitados até ao próximo ciclo |
| Deployments | 100/dia, 1 build concorrente | Bloqueados até ao dia seguinte |
| Duração máx. por função | ~10s (fontes divergem; **a confirmar** no dashboard) | Função terminada (timeout) |
| Imagens otimizadas | 1.000 source images | Serve o original |

Notas:
- **Hobby = uso pessoal, não-comercial** (termos da Vercel). No dia em que o
  Hub gerar receita ou servir clientes, o correto é Pro — $20/user/mês.
- Sem cartão registado **não há fatura surpresa**: o projeto pausa, não cobra.
- Uso esperado do MVP (UI interna + API de jobs): ordens de grandeza abaixo
  destes limites. O primeiro limite a vigiar seria invocations se a Athena
  fizer polling agressivo (ver `docs/ATHENA_MANUAL.md` — espaçar o poll).

### Supabase — plano Free ($0)

| Recurso | Limite Free | Se bater no limite |
|---|---|---|
| Projetos ativos | 2 por organização | Não cria novos |
| Tamanho da DB | 500 MB | Escritas rejeitadas |
| Egress (banda) | ~5 GB/mês | Pedidos com erro (fair-use: 402 até reset/upgrade) |
| File storage | 1 GB | Uploads bloqueados |
| Auth MAUs | 50.000/mês | Novos signups bloqueados |
| Edge Functions | 500K invocations/mês | Throttling |
| Realtime | 200 conexões concorrentes | Novas recusadas |
| Retenção de logs | 1 dia | — |
| **Pausa por inatividade** | **Pausa após 7 dias sem tráfego** | Resume manual no dashboard; cold start 10–30s |
| Backups automáticos | **Não tem** | Ver `docs/RECOVERY.md` §5 |

Uso esperado do MVP: 11 tabelas pequenas (catálogo, jobs, aprovações,
auditoria) — largamente dentro de 500 MB. O risco real do free não é tamanho,
é a **pausa de 7 dias** e a **falta de backups**.

---

## 2. Pode gerar custo (pago ou "a confirmar")

| Item | Estado | Detalhe honesto |
|---|---|---|
| **Apify** | Assinatura **existente** dela — **a confirmar** plano/valor atual | O adapter `apify-mcp` no Hub é **esqueleto** (`execute()` lança `NOT_IMPLEMENTED`). Zero custo pelo Hub hoje. Se um dia executar: cada job exige `maxCostCents` (teto obrigatório no contrato) — sem teto, nem valida. A integração Apify existente via ScalaFlow **não é tocada** por este Hub (regra dela). |
| **Execuções de vídeo** (futuro) | **A confirmar** por provider | Referência medida (não estimativa): PoC Higgsfield em 2026-10-06 — ~$0.48 por clipe de 5s (~$0.10/s) via Kling 3.0-turbo. Qualquer geração paga futura exige aprovação explícita dela **por gasto** (cost gate permanente). |
| **Domínio próprio** | **A confirmar** (ainda não registado) | O MVP vive em `*.vercel.app` ($0). Domínio próprio custa o registo anual (valor depende do TLD/registrar — a confirmar quando ela decidir). |
| **Supabase Pro** | $25/mês/projeto (preço público atual) | Só se ela decidir: 8 GB DB, 250 GB banda, 100 GB storage, **sem pausa**, backups diários (7 dias), 28 dias de logs. Gatilhos honestos para considerar: pausas de 7 dias a incomodar, DB a chegar aos 500 MB, ou dados a precisar de backup automático. |
| **Vercel Pro** | $20/user/mês (preço público atual) | Só se: uso comercial (exigido pelos termos) ou limites do Hobby a bater com frequência. |
| **VPS/RunPod para o worker futuro** | **A confirmar** | O worker de execução real (quando existir) corre **fora** da Vercel — ver `docs/OPERATIONS.md` §5. Custo depende da opção (máquina dela $0 / VPS / RunPod GPU). Nada a pagar no MVP. |

---

## 3. Princípios de custo (regras dela, aplicadas)

1. **Local/offline e open-source primeiro; zero gasto recorrente sem aprovação.**
2. **Nenhum serviço pago é ativado neste MVP** — Postgres/KV/Blob da Vercel,
   Analytics pago, domínios, Pro plans: tudo desligado até decisão explícita.
3. **Teto de gasto obrigatório** em qualquer job que um dia execute provider
   pago (`maxCostCents` no contrato — já está no esqueleto do `apify-mcp`).
4. **Sem cartão = sem surpresa** nos tiers free (pausa em vez de cobrança),
   mas também sem "pagar para continuar" — planear com margem nos limites.
5. Este documento revê-se quando um número mudar: data da verificação no topo.

---

## 4. Resumo de 1 linha

**Hoje: $0/mês** (Vercel Hobby + Supabase Free), com dois asteriscos honestos —
o Supabase free **pausa após 7 dias sem uso** e **não tem backups automáticos**;
o primeiro custo real só aparece se ela decidir ativar Pro, domínio, worker ou
execuções pagas — tudo bloqueado até aprovação explícita dela.
