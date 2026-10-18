/**
 * Testes da dead-letter queue (sem I/O real; deps injetadas).
 * `npx vitest run lib/jobs/dead-letter.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  buildDeadLetterError,
  DEAD_LETTER_EVENT,
  isDeadLettered,
  listDeadLetters,
  sendToDeadLetter,
  type DeadLetterReason,
} from "./dead-letter";

const reason: DeadLetterReason = {
  code: "ATTEMPTS_EXHAUSTED",
  message: "falha após 3 tentativas",
  attemptsUsed: 3,
  maxAttempts: 3,
  lastError: "boom",
};

describe("buildDeadLetterError / isDeadLettered", () => {
  it("constrói erro estruturado com flag dead_lettered", () => {
    const error = buildDeadLetterError(reason);
    expect(error.code).toBe("DEAD_LETTER");
    expect(error.dead_lettered).toBe(true);
    expect(error.dead_letter).toMatchObject({
      reason_code: "ATTEMPTS_EXHAUSTED",
      attempts_used: 3,
      max_attempts: 3,
      last_error: "boom",
    });
    expect(isDeadLettered(error)).toBe(true);
  });

  it("isDeadLettered rejeita erros comuns/nulos", () => {
    expect(isDeadLettered(null)).toBe(false);
    expect(isDeadLettered(undefined)).toBe(false);
    expect(isDeadLettered({ code: "TIMEOUT", message: "x" })).toBe(false);
    expect(isDeadLettered("string")).toBe(false);
  });
});

describe("sendToDeadLetter", () => {
  it("escreve evento dead_letter ANTES de falhar o job (ordem auditável)", async () => {
    const order: string[] = [];
    const deps = {
      appendEvent: async (jobId: string, _org: string, type: string) => {
        order.push(`event:${type}:${jobId}`);
      },
      failJob: async (jobId: string, _org: string, error: Record<string, unknown>) => {
        order.push(`fail:${jobId}:${String(error.code)}`);
      },
    };
    await sendToDeadLetter("j1", "o", reason, deps);
    expect(order).toEqual([`event:${DEAD_LETTER_EVENT}:j1`, "fail:j1:DEAD_LETTER"]);
  });
});

describe("listDeadLetters", () => {
  it("filtra só FAILED com dead_lettered=true", async () => {
    const deps = {
      listFailedWithError: async () => [
        {
          id: "dl1",
          orgId: "o",
          toolId: "tool-a",
          error: buildDeadLetterError(reason),
          createdAt: "2026-10-18T00:00:00.000Z",
        },
        {
          id: "f1",
          orgId: "o",
          toolId: "tool-b",
          error: { code: "TIMEOUT", message: "timeout simples" },
          createdAt: "2026-10-18T00:00:00.000Z",
        },
      ],
    };
    const list = await listDeadLetters("o", deps);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      jobId: "dl1",
      orgId: "o",
      toolId: "tool-a",
      reasonCode: "ATTEMPTS_EXHAUSTED",
      attemptsUsed: 3,
    });
  });

  it("devolve lista vazia quando não há dead-letters", async () => {
    const list = await listDeadLetters("o", { listFailedWithError: async () => [] });
    expect(list).toEqual([]);
  });
});
