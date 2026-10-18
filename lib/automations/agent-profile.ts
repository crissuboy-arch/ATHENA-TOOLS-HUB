/**
 * Athena Tools Hub — perfil de agente com instruções persistentes (FASE 7).
 *
 * Conceito INEMA (degrau 2 — "o seu Jarvis com o INTELECTO" e degrau 1 —
 * AGENTS.md): um assistente próprio tem instruções persistentes que dizem
 * quem ele é e o que pode fazer, e fala com a dona pelo Telegram.
 *
 * Implementação no Hub: estrutura de dados + validador. O perfil NÃO é um
 * agente a correr — é a definição persistente que um executor futuro leria.
 * O envio real pelo Telegram NÃO está implementado (ver publish-schedule.ts
 * para o padrão de stub desativado); aqui modelamos apenas a INTENÇÃO de
 * entrada (comando recebido), que é dado puro e seguro de validar.
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";

/** Política de memória do assistente. */
export const memoryPolicies = ["none", "session", "persistent_summary"] as const;
export type MemoryPolicy = (typeof memoryPolicies)[number];

/** Instruções persistentes de um agente/assistente do Hub. */
export interface AgentProfile {
  id: string;
  /** Nome do assistente (ex.: "Jarvis"). */
  name: string;
  /** Papel em uma frase (ex.: "assistente pessoal de conteúdo"). */
  role: string;
  /**
   * Instruções persistentes — o equivalente ao AGENTS.md do degrau 1.
   * Texto livre, versionado pela dona; o executor nunca inventa permissões.
   */
  instructions: string;
  /** Capacidades que o agente pode usar (nomes de tools do catálogo). */
  allowedCapabilities: string[];
  memoryPolicy: MemoryPolicy;
  /** Idioma de resposta, ex. "pt-BR". */
  locale: string;
  /** Versão das instruções (incrementada a cada edição). */
  instructionsVersion: number;
}

const agentProfileSchema = z.object({
  id: z.string().min(1, "id do perfil é obrigatório.").max(120),
  name: z.string().min(1, "nome do assistente é obrigatório.").max(80),
  role: z.string().min(1, "papel é obrigatório.").max(200),
  instructions: z
    .string()
    .min(20, "instruções persistentes precisam de ao menos 20 caracteres.")
    .max(20000, "instruções excedem 20000 caracteres."),
  allowedCapabilities: z
    .array(z.string().min(1).max(120))
    .max(50, "máximo de 50 capacidades.")
    .default([]),
  memoryPolicy: z.enum(memoryPolicies),
  locale: z.string().min(2).max(12).default("pt-BR"),
  instructionsVersion: z.number().int().min(1).default(1),
});

/** Valida um perfil de agente (puro). */
export function validateAgentProfile(
  input: unknown,
): AutomationResult<AgentProfile> {
  const parsed = agentProfileSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_AGENT_PROFILE",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  return automationOk(parsed.data);
}

/**
 * Intenção recebida de um canal de mensagens (ex.: Telegram).
 * DADO DE ENTRADA validável — não implica envio nem conexão real.
 */
export interface AssistantIntent {
  channel: "telegram";
  /** Identificador do chat de origem (opaco; nunca exibido em logs). */
  chatId: string;
  /** Comando, ex.: "/reel", "/pesquisar", "/status". */
  command: string;
  args: string[];
  receivedAt: string;
}

const assistantIntentSchema = z.object({
  channel: z.literal("telegram"),
  chatId: z.string().min(1, "chatId é obrigatório.").max(120),
  command: z
    .string()
    .regex(/^\/[a-z0-9_]{1,40}$/, "comando deve ser /nome em minúsculas."),
  args: z.array(z.string().max(500)).max(20).default([]),
  receivedAt: z.string().datetime({ offset: true }),
});

/**
 * Interpreta um texto recebido no Telegram como intenção estruturada.
 * Comandos desconhecidos são aceites como dados (o executor decide);
 * o formato é que é validado aqui.
 */
export function parseAssistantIntent(
  channel: "telegram",
  chatId: string,
  text: string,
  receivedAt: string,
): AutomationResult<AssistantIntent> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return automationFail(
      "NOT_A_COMMAND",
      "Texto não é um comando de assistente (deve começar com /).",
    );
  }
  const [command, ...args] = trimmed.split(/\s+/);
  const parsed = assistantIntentSchema.safeParse({
    channel,
    chatId,
    command: command.toLowerCase(),
    args,
    receivedAt,
  });
  if (!parsed.success) {
    return automationFail(
      "INVALID_INTENT",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  return automationOk(parsed.data);
}

/** Resumo legível do perfil (para exibição, sem expor instruções inteiras). */
export function summarizeProfile(profile: AgentProfile): string {
  return (
    `${profile.name} — ${profile.role} ` +
    `(memória: ${profile.memoryPolicy}, ` +
    `${profile.allowedCapabilities.length} capacidade(s), ` +
    `instruções v${profile.instructionsVersion})`
  );
}
