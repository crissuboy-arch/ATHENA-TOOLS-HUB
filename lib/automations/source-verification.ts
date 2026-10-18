/**
 * Athena Tools Hub — validação de fontes e métricas (FASE 7).
 *
 * Conceito INEMA (degrau 4): os xviral "conferem cada número e publicam com
 * a fonte na tela". Aqui: CHECKLIST TIPADO de verificação. Cada item tem
 * categoria, estado e evidência; o veredito final é computado — nunca
 * assumido. Métricas e fontes só entram no relatório de campanha com
 * veredito "aprovado".
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";

export const verificationCategories = [
  "fonte",
  "metrica",
  "data",
  "autoria",
] as const;
export type VerificationCategory = (typeof verificationCategories)[number];

export const itemStatuses = ["pendente", "pass", "fail"] as const;
export type ItemStatus = (typeof itemStatuses)[number];

/** Um item verificável do checklist. */
export interface VerificationItem {
  id: string;
  rotulo: string;
  categoria: VerificationCategory;
  status: ItemStatus;
  /** Evidência que sustenta o veredito (obrigatória para "pass"). */
  evidencia?: string;
  verificadoEm?: string;
}

/** O que está sendo verificado. */
export type VerificationTarget =
  | "resultado_pesquisa"
  | "roteiro"
  | "legenda"
  | "relatorio";

export interface SourceChecklist {
  id: string;
  alvoId: string;
  alvoTipo: VerificationTarget;
  itens: VerificationItem[];
  criadoEm: string;
}

/** Itens padrão por tipo de alvo — o ponto de partida honesto. */
const defaultItems: Record<
  VerificationTarget,
  { id: string; rotulo: string; categoria: VerificationCategory }[]
> = {
  resultado_pesquisa: [
    { id: "fonte-acessivel", rotulo: "URL da fonte abre e corresponde ao título", categoria: "fonte" },
    { id: "autor-identificado", rotulo: "Autor/canal identificado", categoria: "autoria" },
    { id: "metrica-registrada", rotulo: "Cada métrica copiada com data da coleta", categoria: "metrica" },
    { id: "metrica-cruzada", rotulo: "Número cruzado com segunda fonte ou print", categoria: "metrica" },
    { id: "data-publicacao", rotulo: "Data de publicação dentro da janela da pesquisa", categoria: "data" },
  ],
  roteiro: [
    { id: "fonte-afirmacoes", rotulo: "Afirmações factuais têm fonte anotada", categoria: "fonte" },
    { id: "numeros-conferidos", rotulo: "Números citados conferidos na fonte", categoria: "metrica" },
    { id: "sem-promessa", rotulo: "Sem promessa de resultado garantido", categoria: "fonte" },
  ],
  legenda: [
    { id: "tempos-conferidos", rotulo: "Tempos conferidos contra o áudio", categoria: "data" },
    { id: "texto-fiel", rotulo: "Texto fiel ao roteiro aprovado", categoria: "fonte" },
  ],
  relatorio: [
    { id: "metricas-verificadas", rotulo: "Todas as métricas vieram de checklists aprovados", categoria: "metrica" },
    { id: "periodo-correto", rotulo: "Período do relatório confere com os dados", categoria: "data" },
  ],
};

const checklistInputSchema = z.object({
  id: z.string().min(1).max(120),
  alvoId: z.string().min(1).max(120),
  alvoTipo: z.enum(["resultado_pesquisa", "roteiro", "legenda", "relatorio"]),
  criadoEm: z.string().datetime({ offset: true }),
});

/** Cria um checklist com os itens padrão do tipo de alvo. */
export function createChecklist(
  input: unknown,
): AutomationResult<SourceChecklist> {
  const parsed = checklistInputSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_CHECKLIST",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const { id, alvoId, alvoTipo, criadoEm } = parsed.data;
  return automationOk({
    id,
    alvoId,
    alvoTipo,
    criadoEm,
    itens: defaultItems[alvoTipo].map((item) => ({
      ...item,
      status: "pendente" as ItemStatus,
    })),
  });
}

const setStatusInputSchema = z.object({
  status: z.enum(itemStatuses),
  evidencia: z.string().max(2000).optional(),
  verificadoEm: z.string().datetime({ offset: true }),
});

/**
 * Marca o estado de um item. "pass" EXIGE evidência não-vazia —
 * sem evidência, o item não pode ser aprovado (regra anti-"confia").
 */
export function setItemStatus(
  checklist: SourceChecklist,
  itemId: string,
  input: unknown,
): AutomationResult<SourceChecklist> {
  const parsed = setStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_ITEM_STATUS",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  const item = checklist.itens.find((i) => i.id === itemId);
  if (!item) {
    return automationFail(
      "ITEM_NOT_FOUND",
      `Item "${itemId}" não existe no checklist.`,
    );
  }
  const { status, evidencia, verificadoEm } = parsed.data;
  if (status === "pass" && !evidencia?.trim()) {
    return automationFail(
      "EVIDENCE_REQUIRED",
      `Item "${itemId}": "pass" exige evidência registrada.`,
    );
  }
  const itens = checklist.itens.map((i) =>
    i.id === itemId
      ? {
          ...i,
          status,
          evidencia: evidencia?.trim() ? evidencia.trim() : undefined,
          verificadoEm,
        }
      : i,
  );
  return automationOk({ ...checklist, itens });
}

export type ChecklistVerdict = "aprovado" | "reprovado" | "incompleto";

export interface VerdictReport {
  veredito: ChecklistVerdict;
  total: number;
  pass: number;
  fail: number;
  pendentes: string[];
}

/** Computa o veredito: aprovado só com todos "pass". */
export function verdict(checklist: SourceChecklist): VerdictReport {
  const pendentes = checklist.itens
    .filter((i) => i.status === "pendente")
    .map((i) => i.id);
  const fail = checklist.itens.filter((i) => i.status === "fail").length;
  const pass = checklist.itens.filter((i) => i.status === "pass").length;
  const veredito: ChecklistVerdict =
    fail > 0 ? "reprovado" : pendentes.length > 0 ? "incompleto" : "aprovado";
  return { veredito, total: checklist.itens.length, pass, fail, pendentes };
}
