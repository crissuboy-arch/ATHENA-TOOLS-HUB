/**
 * Testes: legendas (SRT/VTT) e roteiros.
 * `npx vitest run lib/automations/captions.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  buildScript,
  formatSRTTime,
  formatVTTTime,
  parseSRT,
  scriptToCues,
  toSRT,
  toVTT,
  validateCues,
} from "./captions";

const cues = [
  { inicioMs: 0, fimMs: 2000, texto: "Você está perdendo vendas." },
  { inicioMs: 2000, fimMs: 4500, texto: "Sem saber por quê." },
];

describe("formatSRTTime / formatVTTTime", () => {
  it("formata tempos corretamente", () => {
    expect(formatSRTTime(0)).toBe("00:00:00,000");
    expect(formatSRTTime(3723004)).toBe("01:02:03,004");
    expect(formatVTTTime(3723004)).toBe("01:02:03.004");
  });
});

describe("validateCues", () => {
  it("aceita faixas válidas e ordena", () => {
    const r = validateCues([...cues].reverse());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].inicioMs).toBe(0);
  });

  it("rejeita sobreposição", () => {
    const r = validateCues([
      { inicioMs: 0, fimMs: 3000, texto: "a" },
      { inicioMs: 2500, fimMs: 4000, texto: "b" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OVERLAPPING_CUES");
  });

  it("rejeita fim <= inicio e texto vazio", () => {
    expect(
      validateCues([{ inicioMs: 1000, fimMs: 1000, texto: "a" }]).ok,
    ).toBe(false);
    expect(validateCues([{ inicioMs: 0, fimMs: 1000, texto: "" }]).ok).toBe(
      false,
    );
  });
});

describe("toSRT / toVTT", () => {
  it("gera SRT válido", () => {
    const r = toSRT(cues);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain("1\n00:00:00,000 --> 00:00:02,000");
      expect(r.value).toContain("Você está perdendo vendas.");
    }
  });

  it("gera VTT com cabeçalho WEBVTT", () => {
    const r = toVTT(cues);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsWith("WEBVTT")).toBe(true);
      expect(r.value).toContain("00:00:00.000 --> 00:00:02.000");
    }
  });

  it("falha com faixas inválidas em vez de gerar lixo", () => {
    expect(toSRT([]).ok).toBe(false);
  });
});

describe("parseSRT", () => {
  it("lê um SRT de volta para faixas validadas", () => {
    const srt = toSRT(cues);
    expect(srt.ok).toBe(true);
    if (srt.ok) {
      const r = parseSRT(srt.value);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toHaveLength(2);
        expect(r.value[0].texto).toBe("Você está perdendo vendas.");
      }
    }
  });

  it("rejeita bloco sem linha de tempo", () => {
    const r = parseSRT("1\nsem tempo aqui\ntexto");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SRT_PARSE_ERROR");
  });
});

const scriptInput = {
  titulo: "Ep. 1",
  blocos: [
    { tipo: "gancho", texto: "Você está perdendo vendas.", duracaoSeg: 3 },
    { tipo: "desenvolvimento", texto: "O motivo é simples.", duracaoSeg: 10 },
    { tipo: "cta", texto: "Comenta QUERO.", duracaoSeg: 3 },
  ],
};

describe("buildScript", () => {
  it("valida e soma a duração total", () => {
    const r = buildScript(scriptInput);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.duracaoTotalSeg).toBe(16);
  });

  it("exige gancho e cta", () => {
    const semCta = {
      ...scriptInput,
      blocos: scriptInput.blocos.filter((b) => b.tipo !== "cta"),
    };
    const r = buildScript(semCta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SCRIPT_MISSING_PARTS");
  });
});

describe("scriptToCues", () => {
  it("distribui blocos em faixas sequenciais", () => {
    const s = buildScript(scriptInput);
    expect(s.ok).toBe(true);
    if (s.ok) {
      const r = scriptToCues(s.value);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toHaveLength(3);
        expect(r.value[0].inicioMs).toBe(0);
        expect(r.value[2].fimMs).toBe(16000);
      }
    }
  });
});
