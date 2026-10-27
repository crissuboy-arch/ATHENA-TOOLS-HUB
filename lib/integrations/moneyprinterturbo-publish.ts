/**
 * Human-review gate for publishing MoneyPrinterTurbo output.
 *
 * Pure validation, no network, no posting. Publishing itself is a MANUAL,
 * out-of-band step performed by a human after this gate passes. There is no
 * automatic post to TikTok, Instagram or YouTube anywhere in this codebase.
 */

export const PUBLISH_CHANNELS = ["tiktok", "instagram", "youtube"] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];

export type HumanApproval = {
  approvedBy: string;
  approvedAt: string;
  channel: PublishChannel;
};

/** Throws unless the approval is a complete, human, channel-scoped record. */
export function requireHumanApproval(approval: unknown): HumanApproval {
  if (typeof approval !== "object" || approval === null) {
    throw new Error("Publicação exige aprovação humana explícita.");
  }
  const record = approval as Record<string, unknown>;
  if (typeof record.approvedBy !== "string" || !record.approvedBy.trim()) {
    throw new Error("Aprovação humana exige quem aprovou.");
  }
  if (
    typeof record.approvedAt !== "string" ||
    Number.isNaN(Date.parse(record.approvedAt))
  ) {
    throw new Error("Aprovação humana exige data válida.");
  }
  if (
    typeof record.channel !== "string" ||
    !(PUBLISH_CHANNELS as readonly string[]).includes(record.channel)
  ) {
    throw new Error("Canal de publicação inválido.");
  }
  return {
    approvedBy: record.approvedBy.trim(),
    approvedAt: record.approvedAt,
    channel: record.channel as PublishChannel,
  };
}

export type PublishHold = {
  status: "awaiting-human-post";
  artifactUrl: string;
  channel: PublishChannel;
  approvedBy: string;
  approvedAt: string;
  postedBy: null;
  note: string;
};

/**
 * Records that a video is cleared for MANUAL posting only. The returned
 * object never triggers a post; a human posts it outside this system.
 */
export function buildPublishHold(
  artifactUrl: string,
  approval: unknown,
): PublishHold {
  const valid = requireHumanApproval(approval);
  if (typeof artifactUrl !== "string" || !artifactUrl.trim()) {
    throw new Error("Artefato obrigatório para a fila de publicação.");
  }
  return {
    status: "awaiting-human-post",
    artifactUrl: artifactUrl.trim(),
    channel: valid.channel,
    approvedBy: valid.approvedBy,
    approvedAt: valid.approvedAt,
    postedBy: null,
    note: "Publicação manual fora da API; nenhum post automático.",
  };
}
