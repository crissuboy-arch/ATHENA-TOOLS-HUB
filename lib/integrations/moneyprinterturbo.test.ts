import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMptTask, submitVideoToMpt } from "./moneyprinterturbo";

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

describe("MoneyPrinterTurbo isolated adapter", () => {
  it("creates video with server-side API key and upstream contract", async () => {
    mockFetch.mockResolvedValue(response({ task_id: "task-123" }));
    await expect(submitVideoToMpt({ video_subject: "Aveiro", video_language: "pt" }))
      .resolves.toEqual({ task_id: "task-123" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(endpoint + "/api/v1/videos");
    expect(options?.headers).toMatchObject({ "x-api-key": "test-key", "content-type": "application/json" });
    expect(JSON.parse(String(options?.body))).toEqual({ video_subject: "Aveiro", video_language: "pt" });
  });

  it("polls task status without creating a second video", async () => {
    mockFetch.mockResolvedValue(response({ task_id: "task-123", state: 1, progress: 100 }));
    await expect(getMptTask("task-123")).resolves.toMatchObject({ progress: 100 });
    expect(mockFetch.mock.calls[0][1]?.method).toBe("GET");
    expect(String(mockFetch.mock.calls[0][0])).toBe(endpoint + "/api/v1/tasks/task-123");
  });

  it("rejects blank topics and malformed task identifiers without networking", async () => {
    await expect(submitVideoToMpt({ video_subject: " " })).rejects.toThrow("Assunto obrigatório");
    await expect(getMptTask("../internal")).rejects.toThrow("ID de tarefa inválido");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed without configuration", async () => {
    vi.stubEnv("MPT_API_KEY", "");
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow("não configurado");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-TLS remote endpoints", async () => {
    vi.stubEnv("MPT_API_BASE_URL", "http://videos.example.test");
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow("inválida");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports upstream HTTP and API errors", async () => {
    mockFetch.mockResolvedValueOnce(response(null, 500, 502));
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow("HTTP 502");
    mockFetch.mockResolvedValueOnce(response(null, 400));
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toThrow("rejeitou");
  });

  it("propagates abort and timeout errors", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    await expect(submitVideoToMpt({ video_subject: "Teste" })).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
