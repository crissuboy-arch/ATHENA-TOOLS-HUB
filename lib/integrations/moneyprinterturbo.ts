/**
 * MoneyPrinterTurbo adapter — server-side only.
 *
 * Deliberately NOT registered as an operational ATHENA executor.
 * Activation requires G3, an isolated MPT deployment, and an authorization
 * boundary that checks organization, tool permission and approval.
 *
 * Upstream API (audited 2026-10-27, harry0703/MoneyPrinterTurbo @ 950ba89,
 * MIT): POST /api/v1/videos, GET /api/v1/tasks/{task_id}.
 * Envelope: { status: 200, message: "success", data: {...} }.
 * Auth: header x-api-key, required only when the server configured one —
 * this adapter ALWAYS requires a key, which is stricter than upstream.
 * Task states: PROCESSING = 4, COMPLETE = 1, FAILED = -1.
 * Queue: upstream defaults max_concurrent_tasks = 5, max_queued_tasks = 100;
 * a full queue answers HTTP 429 (never retried automatically here).
 */
import "server-only";

export type VideoRequest = {
  video_subject: string;
  video_script?: string;
  video_terms?: string | string[];
  video_language?: string;
  video_aspect?: "9:16" | "16:9" | "1:1";
  video_source?: string;
  video_materials?: { provider?: string; url: string; duration?: number }[];
  voice_name?: string;
  bgm_type?: string;
  subtitle_enabled?: boolean;
  video_count?: number;
  video_clip_duration?: number;
  [key: string]: unknown;
};

export type MptEnvelope<T> = { status: number; message?: string; data: T };
export type MptTask = { task_id: string; [key: string]: unknown };

export type MptTaskStatus = {
  task_id: string;
  state: number;
  progress?: number;
  videos?: string[];
  combined_videos?: string[];
  failed_stage?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

/** Upstream task states (app/models/const.py). */
export const MPT_TASK_STATE = {
  FAILED: -1,
  COMPLETE: 1,
  PROCESSING: 4,
} as const;

export function isTerminalMptState(state: number): boolean {
  return state === MPT_TASK_STATE.COMPLETE || state === MPT_TASK_STATE.FAILED;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} inválido.`);
  return value;
}

function getConfig() {
  const configured = process.env.MPT_API_BASE_URL;
  const key = process.env.MPT_API_KEY;
  if (!configured || !key) {
    throw new Error("MoneyPrinterTurbo não configurado; executor permanece inativo.");
  }
  const url = new URL(configured);
  // No credentials, query strings, fragments or plain HTTP to remote hosts.
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("MPT_API_BASE_URL inválida.");
  }
  const timeoutMs = Math.min(
    300_000,
    Math.max(1_000, parseIntEnv("MPT_TIMEOUT_MS", 60_000)),
  );
  const maxInflightRaw = parseIntEnv("MPT_MAX_INFLIGHT", 5);
  if (maxInflightRaw < 0) throw new Error("MPT_MAX_INFLIGHT inválido.");
  return { baseUrl: url.origin, key, timeoutMs, maxInflight: maxInflightRaw };
}

// Client-side guard mirroring the upstream default (5 concurrent tasks).
// Server-side enforcement still lives in MPT (HTTP 429 when its queue is full).
let inFlightCreates = 0;

async function callMpt<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const { baseUrl, key, timeoutMs } = getConfig();
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      "x-api-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        "MoneyPrinterTurbo fila cheia (HTTP 429); tentar mais tarde, sem reenviar automaticamente.",
      );
    }
    throw new Error(`MoneyPrinterTurbo HTTP ${response.status}`);
  }
  const result = (await response.json()) as MptEnvelope<T>;
  if (result.status !== 200 || result.data == null) {
    throw new Error("MoneyPrinterTurbo rejeitou a operação.");
  }
  return result.data;
}

export async function submitVideoToMpt(body: VideoRequest): Promise<MptTask> {
  if (!body.video_subject?.trim()) throw new Error("Assunto obrigatório.");
  const { maxInflight } = getConfig();
  if (inFlightCreates >= maxInflight) {
    throw new Error("MoneyPrinterTurbo limite de tarefas simultâneas atingido.");
  }
  inFlightCreates += 1;
  try {
    return await callMpt<MptTask>("/api/v1/videos", "POST", body);
  } finally {
    inFlightCreates -= 1;
  }
}

export async function getMptTask(taskId: string): Promise<Record<string, unknown>> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("ID de tarefa inválido.");
  return callMpt<Record<string, unknown>>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, "GET");
}

export async function getMptTaskStatus(taskId: string): Promise<MptTaskStatus> {
  const data = await getMptTask(taskId);
  if (typeof data.task_id !== "string" || typeof data.state !== "number") {
    throw new Error("MoneyPrinterTurbo devolveu um estado de tarefa inválido.");
  }
  return data as unknown as MptTaskStatus;
}

export type PollOptions = {
  intervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls until COMPLETE or FAILED. Never posts, never retries creation.
 * Throws on FAILED (with upstream failed_stage/error) and on timeout.
 */
export async function pollMptTask(
  taskId: string,
  options: PollOptions = {},
): Promise<MptTaskStatus> {
  const intervalMs = Math.max(250, options.intervalMs ?? 2000);
  const maxWaitMs = Math.max(1000, options.maxWaitMs ?? 600_000);
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  for (;;) {
    const status = await getMptTaskStatus(taskId);
    if (status.state === MPT_TASK_STATE.COMPLETE) return status;
    if (status.state === MPT_TASK_STATE.FAILED) {
      throw new Error(
        `MoneyPrinterTurbo falhou (etapa: ${status.failed_stage ?? "desconhecida"}): ${status.error ?? "sem detalhe"}`,
      );
    }
    if (Date.now() - started >= maxWaitMs) {
      throw new Error("MoneyPrinterTurbo excedeu o tempo de espera da tarefa.");
    }
    await sleep(intervalMs);
  }
}

/** Video artifact URLs exactly as upstream reports them (videos + combined). */
export function getMptTaskVideoUrls(
  status: MptTaskStatus | Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const key of ["videos", "combined_videos"] as const) {
    const value = (status as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === "string") out.push(entry);
    }
  }
  return out;
}

/**
 * Downloads one task artifact server-side, carrying the same x-api-key.
 * Upstream serves artifacts under /api/v1/download/{task_id}/{file}; a browser
 * address bar cannot attach the header, so this must stay server-side.
 * Only task-relative paths are accepted — never absolute paths or "..".
 */
export async function downloadMptArtifact(entry: string): Promise<ArrayBuffer> {
  let path = entry.trim();
  if (/^https?:\/\//.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      throw new Error("URL de artefato inválida.");
    }
  }
  // Upstream reports "tasks/<id>/<file>" or "/tasks/<id>/<file>" (or the
  // same path under an endpoint prefix); all three forms are accepted.
  path = path.replace(/^\/+/, "");
  if (!path.startsWith("tasks/")) {
    throw new Error("Artefato fora do diretório de tarefas.");
  }
  const remainder = path.slice("tasks/".length);
  const segments = remainder.split("/");
  if (
    segments.length < 2 ||
    segments.some((s) => s === "" || s === ".." || s.includes("\\"))
  ) {
    throw new Error("Caminho de artefato inválido.");
  }
  const { baseUrl, key, timeoutMs } = getConfig();
  const response = await fetch(new URL(`/api/v1/download/${remainder}`, baseUrl), {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`MoneyPrinterTurbo HTTP ${response.status} ao baixar artefato.`);
  }
  return response.arrayBuffer();
}

export type PtBrVerticalInput = {
  video_subject: string;
  video_script?: string;
  video_terms?: string | string[];
  video_materials?: { provider?: string; url: string; duration?: number }[];
  voice_name?: string;
  bgm_type?: string;
  video_clip_duration?: number;
};

/**
 * PT-BR vertical (9:16) request for the isolated MPT engine.
 * Locale form follows upstream (zh-CN / pt-BR style); the default voice is
 * the upstream-listed pt-BR Edge/Azure voice. When local materials are
 * supplied, video_source is "local" so no stock-provider key is needed.
 * Without materials, video_source is left unset (upstream default "pexels",
 * which requires a Pexels key) — callers must not assume a key exists.
 */
export function buildPtBrVerticalRequest(input: PtBrVerticalInput): VideoRequest {
  if (!input.video_subject?.trim()) throw new Error("Assunto obrigatório.");
  const request: VideoRequest = {
    video_subject: input.video_subject.trim(),
    video_language: "pt-BR",
    video_aspect: "9:16",
    voice_name: input.voice_name ?? "pt-BR-FranciscaNeural",
    subtitle_enabled: true,
    video_count: 1,
    video_clip_duration: input.video_clip_duration ?? 5,
  };
  if (input.video_script?.trim()) request.video_script = input.video_script.trim();
  if (input.video_terms) request.video_terms = input.video_terms;
  if (input.bgm_type) request.bgm_type = input.bgm_type;
  if (input.video_materials?.length) {
    request.video_source = "local";
    request.video_materials = input.video_materials;
  }
  return request;
}
