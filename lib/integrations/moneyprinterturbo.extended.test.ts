import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildPtBrVerticalRequest,
  downloadMptArtifact,
  getMptTaskVideoUrls,
  MPT_TASK_STATE,
  pollMptTask,
  submitVideoToMpt,
} from "./moneyprinterturbo";

const endpoint = "https://videos.example.test";
const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("MPT_API_BASE_URL", endpoint);
  vi.stubEnv("MPT_API_KEY", "test-key");
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

function response(data: unknown, status = 200, httpStatus = 200) {
  return new Response(JSON.stringify({ status, message: "success", data }), {
    status: httpStatus,
    headers: { "content-type": "application/json" },
  });
}

function taskStatus(state: number, extra: Record<string, unknown> = {}) {
  return response({ task_id: "task-123", state, progress: 100, ...extra });
}

describe("MoneyPrinterTurbo extended adapter", () => {
  it("reports a full queue distinctly and never retries creation", async () => {
    mockFetch.mockResolvedValueOnce(response(null, 200, 429));
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow(
      "fila cheia",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid timeout and in-flight configuration without networking", async () => {
    vi.stubEnv("MPT_TIMEOUT_MS", "abc");
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow(
      "MPT_TIMEOUT_MS inválido",
    );
    vi.stubEnv("MPT_TIMEOUT_MS", "");
    vi.stubEnv("MPT_MAX_INFLIGHT", "-1");
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow(
      "MPT_MAX_INFLIGHT inválido",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks creation when the in-flight limit is zero", async () => {
    vi.stubEnv("MPT_MAX_INFLIGHT", "0");
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow(
      "limite de tarefas",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("polls processing then complete and returns the final status", async () => {
    mockFetch
      .mockResolvedValueOnce(taskStatus(MPT_TASK_STATE.PROCESSING, { progress: 40 }))
      .mockResolvedValueOnce(
        taskStatus(MPT_TASK_STATE.COMPLETE, { videos: ["tasks/task-123/final-1.mp4"] }),
      );
    const final = await pollMptTask("task-123", {
      intervalMs: 250,
      maxWaitMs: 10_000,
      sleep: () => Promise.resolve(),
    });
    expect(final.state).toBe(MPT_TASK_STATE.COMPLETE);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("polls a failed task with its upstream stage and error", async () => {
    mockFetch.mockResolvedValueOnce(
      taskStatus(MPT_TASK_STATE.FAILED, { failed_stage: "voice", error: "tts falhou" }),
    );
    await expect(
      pollMptTask("task-123", { sleep: () => Promise.resolve() }),
    ).rejects.toThrow("voice");
  });

  it("times out polling instead of waiting forever", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(taskStatus(MPT_TASK_STATE.PROCESSING)),
    );
    await expect(
      pollMptTask("task-123", {
        intervalMs: 250,
        maxWaitMs: 1000,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow("tempo de espera");
  });

  it("builds a PT-BR vertical request with the upstream locale and voice", () => {
    const request = buildPtBrVerticalRequest({
      video_subject: "Aveiro",
      video_script: "Aveiro é uma cidade portuguesa.",
      video_materials: [{ provider: "local", url: "clip.mp4", duration: 6 }],
    });
    expect(request).toMatchObject({
      video_subject: "Aveiro",
      video_language: "pt-BR",
      video_aspect: "9:16",
      voice_name: "pt-BR-FranciscaNeural",
      subtitle_enabled: true,
      video_source: "local",
      video_count: 1,
    });
  });

  it("extracts video urls from both upstream fields", () => {
    expect(
      getMptTaskVideoUrls({
        task_id: "task-123",
        state: 1,
        videos: ["tasks/task-123/final-1.mp4"],
        combined_videos: ["tasks/task-123/combined-1.mp4"],
      }),
    ).toEqual(["tasks/task-123/final-1.mp4", "tasks/task-123/combined-1.mp4"]);
  });

  it("downloads an artifact with the server key and a task-relative path", async () => {
    mockFetch.mockResolvedValueOnce(new Response("fake-bytes", { status: 200 }));
    const buffer = await downloadMptArtifact("tasks/task-123/final-1.mp4");
    expect(buffer.byteLength).toBeGreaterThan(0);
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(endpoint + "/api/v1/download/task-123/final-1.mp4");
    expect(options?.headers).toMatchObject({ "x-api-key": "test-key" });
  });

  it("refuses artifact paths outside the task directory without networking", async () => {
    await expect(downloadMptArtifact("tasks/../secreto.txt")).rejects.toThrow(
      "inválido",
    );
    await expect(downloadMptArtifact("/etc/passwd")).rejects.toThrow("fora do diretório");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
