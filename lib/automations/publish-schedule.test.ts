/**
 * Testes: agendamento de publicação DESATIVADO (stub que recusa).
 * `npx vitest run lib/automations/publish-schedule.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  cancelScheduledPublication,
  listScheduledPublications,
  PUBLICATION_DISABLED_MESSAGE,
  PUBLISHING_ENABLED,
  schedulePublication,
  validateScheduleInput,
} from "./publish-schedule";

const futureInput = {
  id: "pub-1",
  automationId: "reel-1",
  canal: "instagram",
  agendadoPara: "2026-12-01T10:00:00+01:00",
  legenda: "Ep. 1 no ar!",
};

describe("estado desativado", () => {
  it("PUBLISHING_ENABLED é false", () => {
    expect(PUBLISHING_ENABLED).toBe(false);
  });

  it("schedulePublication SEMPRE recusa com erro claro", () => {
    const r = schedulePublication(futureInput);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PUBLICATION_DISABLED");
      expect(r.error.message).toBe(PUBLICATION_DISABLED_MESSAGE);
      expect(r.error.message).toContain("Cristiane");
    }
  });

  it("cancelar e listar também recusam (nada existe para gerir)", () => {
    const c = cancelScheduledPublication("pub-1");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe("PUBLICATION_DISABLED");

    const l = listScheduledPublications();
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.error.code).toBe("PUBLICATION_DISABLED");
  });
});

describe("validateScheduleInput", () => {
  it("valida o formato para planeamento (sem agendar)", () => {
    const r = validateScheduleInput(futureInput);
    expect(r.ok).toBe(true);
  });

  it("rejeita data no passado", () => {
    const r = validateScheduleInput({
      ...futureInput,
      agendadoPara: "2020-01-01T10:00:00+01:00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SCHEDULE_IN_PAST");
  });

  it("rejeita canal desconhecido", () => {
    const r = validateScheduleInput({ ...futureInput, canal: "orkut" });
    expect(r.ok).toBe(false);
  });
});
