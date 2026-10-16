/**
 * Testes da máquina de estados pura (sem I/O).
 * `npx vitest run lib/jobs/machine.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  allStates,
  canTransition,
  cancellableStates,
  isJobStatus,
  isTerminal,
  nextStates,
  terminalStates,
} from "./machine";

describe("job state machine", () => {
  it("expõe os 8 estados", () => {
    expect(allStates).toHaveLength(8);
  });

  it("permite o fluxo feliz com aprovação", () => {
    expect(canTransition("CREATED", "VALIDATING")).toBe(true);
    expect(canTransition("VALIDATING", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "QUEUED")).toBe(true);
    expect(canTransition("QUEUED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "COMPLETED")).toBe(true);
  });

  it("permite o fluxo sem aprovação", () => {
    expect(canTransition("VALIDATING", "QUEUED")).toBe(true);
  });

  it("permite cancelamento a partir de estados não-terminais", () => {
    for (const s of cancellableStates) {
      expect(canTransition(s, "CANCELLED")).toBe(true);
    }
  });

  it("permite falha a partir de VALIDATING/QUEUED/RUNNING", () => {
    expect(canTransition("VALIDATING", "FAILED")).toBe(true);
    expect(canTransition("QUEUED", "FAILED")).toBe(true);
    expect(canTransition("RUNNING", "FAILED")).toBe(true);
  });

  it("rejeita transições ilegais", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "RUNNING")).toBe(false);
    expect(canTransition("QUEUED", "PENDING_APPROVAL")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("FAILED", "QUEUED")).toBe(false);
    expect(canTransition("CANCELLED", "RUNNING")).toBe(false);
    expect(canTransition("RUNNING", "QUEUED")).toBe(false);
  });

  it("estados terminais não têm saída", () => {
    for (const s of terminalStates) {
      expect(nextStates(s)).toHaveLength(0);
      expect(isTerminal(s)).toBe(true);
    }
    expect(isTerminal("RUNNING")).toBe(false);
  });

  it("isJobStatus valida strings desconhecidas", () => {
    expect(isJobStatus("QUEUED")).toBe(true);
    expect(isJobStatus("NOPE")).toBe(false);
    expect(isJobStatus(null)).toBe(false);
  });
});
