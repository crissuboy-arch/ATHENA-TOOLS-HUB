# FASE 7 — Automações (conceitos INEMA no Hub)

> Material de referência funcional: INEMA — "Do chat ao agente" (degraus 1–4).
> Os nomes **r7e**, **promoavatar** e **xviral** são REFERÊNCIA FUNCIONAL do
> material — não prova de código aberto nem de integração. Nada aqui executa
> vídeo real, coleta ao vivo, avatar ou publicação.

## Mapeamento conceito → implementação

| Conceito INEMA | O que é no material | Implementação no Hub | Estado honesto |
|---|---|---|---|
| Degrau 1 — pasta do agente (AGENTS.md) | Instruções persistentes: quem o agente é, o que pode fazer | `lib/automations/agent-profile.ts` — `AgentProfile` + `validateAgentProfile` | **Estrutural** — define o perfil; nenhum agente a correr |
| Degrau 2 — Jarvis no Telegram | Assistente próprio que fala pelo Telegram e lembra das conversas | `parseAssistantIntent` — interpreta `/comando` como intenção tipada | **Estrutural (entrada)** — valida intenção recebida; envio real NÃO implementado |
| Degrau 3 — fila durável com portões | Pedidos viram tarefas; fluxos param num portão antes do que importa | `lib/automations/approval-gate.ts` — declara por tipo se exige `PENDING_APPROVAL` | **Reutiliza fluxo existente** — máquina `lib/jobs/machine.ts` + `GET /api/v1/approvals`; nada duplicado |
| r7e — reel em etapas de gatilho | Monta o reel em etapas | `lib/automations/reel-pipeline.ts` — `roteiro → cenas → legendas → montagem → revisao`, cada etapa = estrutura + validador + transição | **Estrutural** — produz planos validados; "montagem" é o plano de edição (`planoSomente: true`), nunca renderização |
| promoavatar — vídeo para cada público | Vídeos com avatar adaptados por público | `lib/automations/audience-profiles.ts` — `AudienceProfile` + regras declarativas (`adaptScriptForAudience`) | **Estrutural** — adapta ROTEIRO (duração do gancho, ritmo, avisos de termos); não gera vídeo/avatar nem reescreve texto com IA |
| xviral — observar o nicho | Assistem ao que os maiores do nicho publicaram | `lib/automations/research.ts` — `ResearchJob` + `ingestResults` + `aggregateResults` | **Estrutural** — coleta ao vivo NÃO implementada; resultados entram por ingestão manual validada |
| xviral — conferir cada número | Conferem cada métrica | `lib/automations/source-verification.ts` — checklist tipado; `pass` exige evidência; veredito computado | **Real (lógica)** — validação pura, funcional de verdade |
| xviral — fonte na tela | Publicam com a fonte na tela | `lib/automations/publish-schedule.ts` — stub tipado | **DESATIVADO** — recusa com `PUBLICATION_DISABLED` até autorização explícita da Cristiane (bloqueio 2026-10-18) |
| Preparação de legendas/roteiros | Matéria-prima do reel | `lib/automations/captions.ts` — `toSRT`/`toVTT`/`parseSRT`, `buildScript`, `scriptToCues` | **Real** — computação pura, saída usável de verdade |
| Fechar o ciclo | Histórico e resultados | `lib/automations/campaign-report.ts` — `buildReport` + `finalizeReport` (exige checklists aprovados para métricas) | **Real (lógica)** — agregação pura; "final" bloqueia número sem fonte verificada |

## O que é REAL vs ESTRUTURAL

**Real (funciona de verdade, sem dependência externa):**
- Validadores e transições do pipeline de reels (`reel-pipeline.ts`)
- Geração/validação de SRT/VTT e estrutura de roteiro (`captions.ts`)
- Regras de adaptação de roteiro por público (`audience-profiles.ts`)
- Validação de job de pesquisa, ingestão e agregação (`research.ts`)
- Checklist de verificação com veredito computado (`source-verification.ts`)
- Portão de aprovação declarativo (`approval-gate.ts`)
- Construção/finalização de relatório de campanha (`campaign-report.ts`)

**Estrutural (planeia/valida, não executa):**
- Perfil de agente e intenção do assistente (`agent-profile.ts`)
- Pipeline de reels como um todo (etapas validadas, sem render)
- Adaptação por público (sem geração de vídeo/avatar)
- Pesquisa (sem coleta ao vivo — só ingestão validada)

**Desativado por ordem da Cristiane:**
- Agendamento de publicação (`publish-schedule.ts`) — `PUBLISHING_ENABLED = false`;
  `schedulePublication` / `cancelScheduledPublication` / `listScheduledPublications`
  recusam com `PUBLICATION_DISABLED`: "Publicação desativada até autorização
  explícita da Cristiane (bloqueio de 2026-10-18)."

## Regras que o código impõe

1. **Nada operacional sem teste** — 9 ficheiros de teste cobrem validadores e transições.
2. **Portão humano** — `reel_pipeline`, `audience_video`, `campaign_report` e
   `scheduled_publish` exigem `PENDING_APPROVAL` (fluxo existente em
   `/api/v1/approvals`, scope `approvals:decide`).
3. **"Pass" exige evidência** — item de verificação não pode ser aprovado sem
   evidência registada (`EVIDENCE_REQUIRED`).
4. **Número sem fonte não entra no relatório final** — `finalizeReport` exige
   checklist com veredito `aprovado` para cada automação com métricas.
5. **Revisão reprovada não conclui pipeline** — `advancePipeline` recusa com
   `REVIEW_REJECTED`.
6. **Ingestão tudo-ou-nada** — um resultado inválido falha a ingestão inteira.

## Catálogo via API

`GET /api/v1/automations` (scope `tools:read`) lista as capacidades com o
estado honesto (`executionReady`, `requiresApproval`). Somente leitura;
não toca nas rotas existentes.

## NÃO VERIFICADO / fora de escopo

- Nenhum executor real conectado (render, coleta ao vivo, avatar, Telegram,
  publicação) — tudo marcado `executionReady: false` exceto computação pura.
- Integração com filas/jobs persistentes (Supabase): o pipeline usa tipos
  compatíveis com a máquina de jobs, mas a persistência não foi ligada.
- Os nomes r7e/promoavatar/xviral não correspondem a código ou APIs
  verificadas — são apenas o vocabulário funcional do material INEMA.
