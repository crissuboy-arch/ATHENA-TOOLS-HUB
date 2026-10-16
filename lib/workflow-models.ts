/**
 * Domain types mirroring the real /api/v1 DTOs (camelCase).
 * pt-BR labels for job states per spec.
 */

export type JobState =
  | "CREATED"
  | "VALIDATING"
  | "PENDING_APPROVAL"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const JOB_STATE_LABELS: Record<JobState, string> = {
  CREATED: "Criada",
  VALIDATING: "Validando",
  PENDING_APPROVAL: "Aguardando aprovação",
  QUEUED: "Na fila",
  RUNNING: "Executando",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const JOB_STATES = Object.keys(JOB_STATE_LABELS) as JobState[];

/** States where a job can still be cancelled by the user. */
export const CANCELLABLE_STATES: JobState[] = [
  "CREATED",
  "VALIDATING",
  "PENDING_APPROVAL",
  "QUEUED",
  "RUNNING",
];

export type IntegrationStatus = "pending" | "ready";

export interface Tool {
  id: string;
  name: string;
  description: string | null;
  version: string;
  status: string;
  capabilities: string[];
  updatedAt: string;
  /** Only present on the detail endpoint. 'ready' = real executor connected. */
  integrationStatus?: IntegrationStatus;
}

export const TOOL_STATUS_LABELS: Record<string, string> = {
  cataloged: "Catalogada",
  "needs-config": "Precisa de configuração",
  "in-development": "Em desenvolvimento",
  connected: "Conectada",
  "operational-tested": "Operacional",
  error: "Com erro",
  unavailable: "Indisponível",
  unknown: "Desconhecida",
};

export function toolStatusLabel(status: string): string {
  return TOOL_STATUS_LABELS[status] ?? status;
}

/** A tool can really execute only when a real executor is connected. */
export function isToolOperational(tool: Tool): boolean {
  return tool.integrationStatus === "ready";
}

export interface Job {
  id: string;
  orgId: string;
  toolId: string;
  /** Resolved client-side from the tools catalog (not in the DTO). */
  toolName?: string | null;
  status: JobState;
  params: Record<string, unknown>;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  result: unknown;
  integrationStatus: IntegrationStatus;
}

export interface JobEvent {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  payload: unknown;
  actorId: string;
  actorType: string;
  createdAt: string;
}

/** Human-readable note carried inside an event payload, when present. */
export function eventMessage(ev: JobEvent): string | null {
  if (ev.payload !== null && typeof ev.payload === "object") {
    const p = ev.payload as Record<string, unknown>;
    if (typeof p.note === "string" && p.note) return p.note;
    if (typeof p.message === "string" && p.message) return p.message;
    if (typeof p.justification === "string" && p.justification) return p.justification;
  }
  return null;
}

export interface Asset {
  id: string;
  kind: string;
  url: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /** Attached client-side (assets are listed per job). */
  jobId?: string;
  toolName?: string | null;
}

export function assetName(a: Asset): string {
  const m = a.metadata ?? {};
  const fromMeta =
    (typeof m.name === "string" && m.name) ||
    (typeof m.filename === "string" && m.filename) ||
    (typeof m.title === "string" && m.title);
  if (fromMeta) return fromMeta;
  try {
    const file = a.url.split("?")[0].split("/").pop();
    if (file) return decodeURIComponent(file);
  } catch {
    /* ignore */
  }
  return a.id;
}

export function assetKindLabel(kind: string): string {
  const k = kind.toLowerCase();
  if (k === "image") return "Imagem";
  if (k === "video") return "Vídeo";
  if (k === "audio") return "Áudio";
  if (k === "doc" || k === "document" || k === "pdf") return "Documento";
  if (k === "data" || k === "json" || k === "csv") return "Dados";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function assetSize(a: Asset): number | null {
  const m = a.metadata ?? {};
  for (const key of ["size_bytes", "sizeBytes", "size"]) {
    const v = m[key];
    if (typeof v === "number") return v;
  }
  return null;
}

export function isImageKind(kind: string): boolean {
  return kind.toLowerCase() === "image";
}

export interface Org {
  id: string;
  name: string;
  role?: string;
}

/* ---------- formatters ---------- */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API requires the idempotency key to be a UUID. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}
