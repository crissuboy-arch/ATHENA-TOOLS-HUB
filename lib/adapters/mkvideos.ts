/**
 * Athena Tools Hub — conector MKVideos (ContratoPonteV1).
 *
 * REFERÊNCIA (só leitura — repo separado, NÃO copiado nem alterado):
 *   ~/workspace/mkvideos-ofensiva-criativa/docs/athena-integracao.md
 *   ~/workspace/mkvideos-ofensiva-criativa/src/athena/adapter.ts
 *   (branch feat/athena-mkvideos-adapter)
 *
 * DIVISÃO DE RESPONSABILIDADES (regra dura):
 * - O MKVideos é um repositório separado. O Hub NÃO executa o pipeline
 *   MKVideos e NÃO duplica o executor que o Cláudio implementa na Athena
 *   (Fase 7, missão CRIAR_VIDEO → adapter MKVideos).
 * - O Hub regista a ferramenta `mkvideos`, constrói envelopes de missão
 *   CRIAR_VIDEO válidos (ContratoPonteV1), acompanha jobs por poll de
 *   estados queued/running/done/failed e expõe os artefactos devolvidos.
 *
 * Os tipos abaixo espelham o FORMATO DE FIO documentado em
 * docs/athena-integracao.md (JSON de `athena-receive` / `athena-status`),
 * não código do MKVideos.
 *
 * Estado honesto: catalogado. `executionReady` é false até existir uma
 * ligação real ao executor (CLI `mkivideos athena-receive` /
 * `mkivideos athena-status` num worker isolado — fora do frontend).
 * `execute()` lança 501 — nenhuma execução simulada.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Skills de vídeo que o MKVideos expõe na fila (documentado no adapter). */
export const MKVIDEO_SKILLS = ["explicativo", "curso", "demo"] as const;
export type MKVideoSkill = (typeof MKVIDEO_SKILLS)[number];

/** Estados de job devolvidos por `athena-status` (formato de fio). */
export type MKVideosJobStatus = "queued" | "running" | "done" | "failed";

/**
 * Envelope de missão CRIAR_VIDEO (subconjunto do ContratoPonteV1 relevante
 * para este executor). Formato documentado em docs/athena-integracao.md.
 */
export interface CriarVideoMission {
  schema_version: "1.0";
  mission_id: string;
  handoff_id?: string;
  mission_type: "CRIAR_VIDEO";
  objective: string;
  requires_human_approval?: boolean;
  requested_outputs: ["video"];
  context?: {
    video_skill?: MKVideoSkill;
    vertical?: boolean;
  };
}

/** Resultado de `athena-status --mission <id>` (formato de fio). */
export interface MKVideosResult {
  mission_id: string;
  status: MKVideosJobStatus;
  outputs: { video: string } | null;
  error: string | null;
}

/** Entrada de alto nível para construir uma missão CRIAR_VIDEO. */
export interface CriarVideoInput {
  objective: string;
  videoSkill?: MKVideoSkill;
  vertical?: boolean;
  requiresHumanApproval?: boolean;
  handoffId?: string;
}

/**
 * Regex de mission_id — a MESMA regra documentada no adapter do MKVideos:
 * 3–81 chars, alfanumérico mais . _ : -
 */
export const MISSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,80}$/;

/** Gera um mission_id válido e único (prefixo + UUID). */
export function newMissionId(prefix = "hub"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Constrói e valida um envelope CRIAR_VIDEO. Função pura — sem I/O.
 * Devolve `{ ok: true, mission }` ou `{ ok: false, errors }`.
 */
export function buildCriarVideoMission(
  input: CriarVideoInput,
  missionId: string = newMissionId(),
): { ok: true; mission: CriarVideoMission } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!MISSION_ID_RE.test(missionId)) {
    errors.push("mission_id: formato inválido (3–81 chars, [A-Za-z0-9._:-])");
  }
  if (!input.objective || !input.objective.trim()) {
    errors.push("objective: é obrigatório e não pode ser vazio");
  }
  const skill = input.videoSkill ?? "explicativo";
  if (!(MKVIDEO_SKILLS as readonly string[]).includes(skill)) {
    errors.push(
      `videoSkill: '${input.videoSkill}' inválido — use ${MKVIDEO_SKILLS.join(", ")}`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const mission: CriarVideoMission = {
    schema_version: "1.0",
    mission_id: missionId,
    mission_type: "CRIAR_VIDEO",
    objective: input.objective.trim(),
    requested_outputs: ["video"],
    requires_human_approval: input.requiresHumanApproval ?? true,
    context: {
      video_skill: skill as MKVideoSkill,
      vertical: input.vertical ?? false,
    },
  };
  if (input.handoffId) mission.handoff_id = input.handoffId;
  return { ok: true, mission };
}

/** Um job atingiu estado final (tem artefacto ou erro definitivo). */
export function isTerminalStatus(status: MKVideosJobStatus): boolean {
  return status === "done" || status === "failed";
}

/** Visão resumida de um resultado de poll, pronta para a UI do Hub. */
export interface JobSnapshot {
  missionId: string;
  status: MKVideosJobStatus;
  terminal: boolean;
  /** Caminho do MP4 quando status=done; null nos outros estados. */
  videoPath: string | null;
  error: string | null;
}

/**
 * Traduz o payload de `athena-status` para o snapshot que o Hub exibe.
 * Função pura — o poll real (CLI/worker) ainda não está ligado.
 */
export function toJobSnapshot(result: MKVideosResult): JobSnapshot {
  return {
    missionId: result.mission_id,
    status: result.status,
    terminal: isTerminalStatus(result.status),
    videoPath: result.status === "done" ? (result.outputs?.video ?? null) : null,
    error: result.error,
  };
}

/** Params aceitos pelo contrato do Hub para a tool mkvideos. */
const mkVideosParamsSchema = z
  .object({
    objective: z.string().min(1, "objective é obrigatório.").max(5000),
    videoSkill: z.enum(MKVIDEO_SKILLS).default("explicativo"),
    vertical: z.boolean().default(false),
    requiresHumanApproval: z.boolean().default(true),
    handoffId: z.string().max(200).optional(),
    missionId: z
      .string()
      .regex(MISSION_ID_RE, "mission_id em formato inválido.")
      .optional(),
  })
  .passthrough();

export class MKVideosAdapter implements ToolContract {
  readonly id = "mkvideos";
  readonly version = "0.1.0-contract";
  readonly capabilities = ["video.generate"];
  /**
   * O executor real vive na Athena (Fase 7, Cláudio). O Hub acompanha
   * jobs e artefactos quando a ligação ao worker estiver configurada.
   */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = mkVideosParamsSchema.safeParse(params);
    if (result.success) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "params"}: ${i.message}`,
      ),
    };
  }

  dryRunInfo(): DryRunInfo {
    return {
      // Gerar vídeo custa GPU/worker — sempre exige aprovação humana.
      requiresApproval: true,
      estimatedCost: "a definir (executor MKVideos na Athena, Fase 7)",
    };
  }

  /**
   * Submissão real — AINDA NÃO LIGADA.
   * O executor CRIAR_VIDEO é implementado na Athena (Fase 7); o Hub não o
   * duplica nem simula. Lança 501 até a ligação ao worker existir.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "executor MKVideos vive na Athena (Fase 7) — o Hub acompanha jobs e " +
        "artefactos quando a ligação ao worker estiver configurada; " +
        "nenhuma execução simulada",
    );
  }
}

/** Registra o conector no registry global. Importar este módulo = registrar. */
toolRegistry.register(new MKVideosAdapter());
