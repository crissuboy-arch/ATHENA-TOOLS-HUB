/**
 * Athena Tools Hub — produção de vídeo por perfil de público (FASE 7).
 *
 * Conceito INEMA (degrau 4): o promoavatar "faz vídeos com avatar para cada
 * público". Aqui: perfis de audiência tipados + REGRAS de adaptação de
 * roteiro. As regras são dados declarativos e transformações puras —
 * nenhuma gera vídeo ou avatar de verdade (isso exigiria executor real).
 *
 * Honestidade: adaptScriptForAudience NÃO reescreve texto com IA; aplica
 * regras estruturais (duração do gancho, ritmo, avisos de vocabulário
 * sensível) e sinaliza o que precisa de revisão humana.
 */

import { z } from "zod";
import {
  automationFail,
  automationOk,
  type AutomationResult,
} from "./types";
import {
  buildScript,
  type Script,
  type ScriptBlock,
} from "./captions";

/* --------------------------- perfil de público --------------------------- */

export const audienceTones = [
  "formal",
  "casual",
  "urgente",
  "educativo",
  "inspirador",
] as const;
export type AudienceTone = (typeof audienceTones)[number];

export const audiencePaces = ["lento", "medio", "rapido"] as const;
export type AudiencePace = (typeof audiencePaces)[number];

/** Perfil de audiência: para QUEM o vídeo é adaptado. */
export interface AudienceProfile {
  id: string;
  nome: string;
  /** Faixa etária alvo [min, max]. */
  faixaEtaria: [number, number];
  interesses: string[];
  tom: AudienceTone;
  ritmo: AudiencePace;
  idioma: string;
  /** Termos a evitar para este público (verificação, não censura). */
  evitar: string[];
  /** Duração máxima do gancho em segundos para este público. */
  ganchoMaxSeg: number;
}

const audienceProfileSchema = z
  .object({
    id: z.string().min(1).max(120),
    nome: z.string().min(1, "nome do público é obrigatório.").max(120),
    faixaEtaria: z
      .tuple([z.number().int().min(0).max(120), z.number().int().min(0).max(120)])
      .refine(([min, max]) => min <= max, {
        message: "faixaEtaria: min deve ser ≤ max.",
      }),
    interesses: z.array(z.string().min(1).max(120)).max(30).default([]),
    tom: z.enum(audienceTones),
    ritmo: z.enum(audiencePaces),
    idioma: z.string().min(2).max(12).default("pt-BR"),
    evitar: z.array(z.string().min(1).max(80)).max(50).default([]),
    ganchoMaxSeg: z.number().int().min(1).max(30).default(5),
  })
  .transform((p) => p as AudienceProfile);

/** Valida um perfil de audiência (puro). */
export function validateAudienceProfile(
  input: unknown,
): AutomationResult<AudienceProfile> {
  const parsed = audienceProfileSchema.safeParse(input);
  if (!parsed.success) {
    return automationFail(
      "INVALID_AUDIENCE_PROFILE",
      parsed.error.issues.map((i) => i.message).join(" "),
    );
  }
  return automationOk(parsed.data);
}

/* ------------------------------ regras ------------------------------ */

/** Ajuste aplicado a um bloco de roteiro. */
export interface BlockAdjustment {
  blocoIndex: number;
  campo: "duracaoSeg" | "texto";
  antes: string | number;
  depois: string | number;
  motivo: string;
}

export interface AdaptationReport {
  profileId: string;
  scriptAdaptado: Script;
  ajustes: BlockAdjustment[];
  /** Regras que dispararam, por id. */
  regrasAplicadas: string[];
  /** Avisos que exigem revisão humana (ex.: termo da lista "evitar"). */
  avisos: string[];
}

/**
 * Regras de adaptação — declarativas e auditáveis. Cada regra tem um id
 * estável para aparecer no relatório e no histórico da campanha.
 */
interface AdaptationRule {
  id: string;
  descricao: string;
  aplica(
    profile: AudienceProfile,
    blocos: ScriptBlock[],
  ): { blocos: ScriptBlock[]; ajustes: BlockAdjustment[]; avisos: string[] };
}

const rules: AdaptationRule[] = [
  {
    id: "gancho-curto",
    descricao:
      "Limita a duração do gancho ao máximo do público (atenção inicial).",
    aplica(profile, blocos) {
      const ajustes: BlockAdjustment[] = [];
      const next = blocos.map((b, i) => {
        if (b.tipo === "gancho" && b.duracaoSeg > profile.ganchoMaxSeg) {
          ajustes.push({
            blocoIndex: i,
            campo: "duracaoSeg",
            antes: b.duracaoSeg,
            depois: profile.ganchoMaxSeg,
            motivo: `gancho limitado a ${profile.ganchoMaxSeg}s para "${profile.nome}".`,
          });
          return { ...b, duracaoSeg: profile.ganchoMaxSeg };
        }
        return b;
      });
      return { blocos: next, ajustes, avisos: [] };
    },
  },
  {
    id: "ritmo-rapido",
    descricao:
      "Público de ritmo rápido: blocos de desenvolvimento acima de 20s são sinalizados para corte.",
    aplica(profile, blocos) {
      const avisos: string[] = [];
      if (profile.ritmo === "rapido") {
        blocos.forEach((b, i) => {
          if (b.tipo === "desenvolvimento" && b.duracaoSeg > 20) {
            avisos.push(
              `Bloco ${i} ("${b.tipo}") tem ${b.duracaoSeg}s — considerar corte para ritmo rápido.`,
            );
          }
        });
      }
      return { blocos, ajustes: [], avisos };
    },
  },
  {
    id: "ritmo-lento",
    descricao:
      "Público de ritmo lento: garante ao menos 8s no bloco de prova (tempo de absorção).",
    aplica(profile, blocos) {
      const ajustes: BlockAdjustment[] = [];
      const next = blocos.map((b, i) => {
        if (
          profile.ritmo === "lento" &&
          b.tipo === "prova" &&
          b.duracaoSeg < 8
        ) {
          ajustes.push({
            blocoIndex: i,
            campo: "duracaoSeg",
            antes: b.duracaoSeg,
            depois: 8,
            motivo: "prova estendida para 8s (ritmo lento).",
          });
          return { ...b, duracaoSeg: 8 };
        }
        return b;
      });
      return { blocos: next, ajustes, avisos: [] };
    },
  },
  {
    id: "termos-a-evitar",
    descricao:
      "Sinaliza termos da lista 'evitar' presentes no texto (revisão humana decide).",
    aplica(profile, blocos) {
      const avisos: string[] = [];
      const termos = profile.evitar.map((t) => t.toLowerCase());
      blocos.forEach((b, i) => {
        const texto = b.texto.toLowerCase();
        for (const termo of termos) {
          if (termo && texto.includes(termo)) {
            avisos.push(
              `Bloco ${i} contém o termo "${termo}" (lista "evitar" de "${profile.nome}") — revisar.`,
            );
          }
        }
      });
      return { blocos, ajustes: [], avisos };
    },
  },
  {
    id: "tom-cta",
    descricao:
      "Anota o tom esperado no CTA para a revisão humana (não reescreve texto).",
    aplica(profile, blocos) {
      const avisos: string[] = [];
      const hasCta = blocos.some((b) => b.tipo === "cta");
      if (hasCta) {
        avisos.push(
          `CTA deve soar "${profile.tom}" para "${profile.nome}" — conferir na revisão.`,
        );
      }
      return { blocos, ajustes: [], avisos };
    },
  },
];

/** Lista as regras disponíveis (id + descrição) — auditável. */
export function listAdaptationRules(): { id: string; descricao: string }[] {
  return rules.map((r) => ({ id: r.id, descricao: r.descricao }));
}

/**
 * Adapta um roteiro a um perfil de público aplicando as regras.
 * Puro: não gera vídeo, não chama IA — produz roteiro ajustado + relatório.
 */
export function adaptScriptForAudience(
  scriptInput: unknown,
  profileInput: unknown,
): AutomationResult<AdaptationReport> {
  const scriptCheck = buildScript(scriptInput);
  if (!scriptCheck.ok) return scriptCheck as AutomationResult<AdaptationReport>;
  const profileCheck = validateAudienceProfile(profileInput);
  if (!profileCheck.ok)
    return profileCheck as AutomationResult<AdaptationReport>;

  const profile = profileCheck.value;
  let blocos: ScriptBlock[] = scriptCheck.value.blocos.map((b) => ({ ...b }));
  const ajustes: BlockAdjustment[] = [];
  const avisos: string[] = [];
  const regrasAplicadas: string[] = [];

  for (const rule of rules) {
    const out = rule.aplica(profile, blocos);
    blocos = out.blocos;
    if (out.ajustes.length > 0 || out.avisos.length > 0) {
      regrasAplicadas.push(rule.id);
    }
    ajustes.push(...out.ajustes);
    avisos.push(...out.avisos);
  }

  const titulo = `${scriptCheck.value.titulo} — ${profile.nome}`;
  return automationOk({
    profileId: profile.id,
    scriptAdaptado: {
      titulo,
      blocos,
      duracaoTotalSeg: blocos.reduce((acc, b) => acc + b.duracaoSeg, 0),
    },
    ajustes,
    regrasAplicadas,
    avisos,
  });
}
