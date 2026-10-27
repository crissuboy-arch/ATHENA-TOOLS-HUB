/**
 * MoneyPrinterTurbo adapter — server-side only.
 *
 * Deliberately NOT registered as an operational ATHENA executor.
 * Activation requires G3, an isolated MPT deployment, and an authorization
 * boundary that checks organization, tool permission and approval.
 *
 * Upstream API: https://github.com/harry0703/MoneyPrinterTurbo
 * POST /api/v1/videos, GET /api/v1/tasks/{task_id}
 */
import "server-only";

export type VideoRequest = {
  video_subject: string;
  video_language?: string;
  video_aspect?: "9:16" | "16:9" | "1:1";
  [key: string]: unknown;
};

export type MptEnvelope<T> = { status: number; message?: string; data: T };
export type MptTask = { task_id: string; [key: string]: unknown };

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
  return { baseUrl: url.origin, key };
}

async function callMpt<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const { baseUrl, key } = getConfig();
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      "x-api-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!response.ok) {
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
  return callMpt<MptTask>("/api/v1/videos", "POST", body);
}

export async function getMptTask(taskId: string): Promise<Record<string, unknown>> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) throw new Error("ID de tarefa inválido.");
  return callMpt<Record<string, unknown>>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, "GET");
}
