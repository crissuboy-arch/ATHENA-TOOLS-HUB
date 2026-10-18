/**
 * Testes: perfil de agente (instruções persistentes) e intenção do assistente.
 * `npx vitest run lib/automations/agent-profile.test.ts`
 */
import { describe, expect, it } from "vitest";
import {
  parseAssistantIntent,
  summarizeProfile,
  validateAgentProfile,
} from "./agent-profile";

const NOW = "2026-10-18T12:00:00+01:00";

const validProfile = {
  id: "jarvis-1",
  name: "Jarvis",
  role: "assistente pessoal de conteúdo",
  instructions:
    "Você é o assistente pessoal da Cristiane. Responde em pt-BR, direto e sem enrolação.",
  allowedCapabilities: ["trend_research", "content_prep"],
  memoryPolicy: "persistent_summary",
  locale: "pt-BR",
  instructionsVersion: 1,
};

describe("validateAgentProfile", () => {
  it("aceita um perfil válido", () => {
    const r = validateAgentProfile(validProfile);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("Jarvis");
  });

  it("rejeita instruções curtas demais (nada de perfil vazio)", () => {
    const r = validateAgentProfile({ ...validProfile, instructions: "curto" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_AGENT_PROFILE");
  });

  it("rejeita memoryPolicy inválida", () => {
    const r = validateAgentProfile({ ...validProfile, memoryPolicy: "eterna" });
    expect(r.ok).toBe(false);
  });

  it("aplica defaults de locale e versão", () => {
    const { id, name, role, instructions, allowedCapabilities, memoryPolicy } =
      validProfile;
    const r = validateAgentProfile({
      id,
      name,
      role,
      instructions,
      allowedCapabilities,
      memoryPolicy,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.locale).toBe("pt-BR");
      expect(r.value.instructionsVersion).toBe(1);
    }
  });
});

describe("parseAssistantIntent", () => {
  it("interpreta um comando do Telegram", () => {
    const r = parseAssistantIntent("telegram", "chat-42", "/reel ideia nova", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.command).toBe("/reel");
      expect(r.value.args).toEqual(["ideia", "nova"]);
      expect(r.value.channel).toBe("telegram");
    }
  });

  it("normaliza o comando para minúsculas", () => {
    const r = parseAssistantIntent("telegram", "chat-42", "/Status", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.command).toBe("/status");
  });

  it("rejeita texto que não é comando", () => {
    const r = parseAssistantIntent("telegram", "chat-42", "olá jarvis", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_A_COMMAND");
  });

  it("rejeita comando malformado", () => {
    const r = parseAssistantIntent("telegram", "chat-42", "/comando!invalido", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_INTENT");
  });
});

describe("summarizeProfile", () => {
  it("resume sem expor as instruções inteiras", () => {
    const r = validateAgentProfile(validProfile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const s = summarizeProfile(r.value);
      expect(s).toContain("Jarvis");
      expect(s).not.toContain("Responde em pt-BR, direto");
    }
  });
});
