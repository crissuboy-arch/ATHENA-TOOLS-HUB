/**
 * Catalog domain types — ATHENA TOOLS HUB.
 *
 * Hard rule: tool states are HONEST ONLY.
 * A tool is never marked "operational-tested" without a real passing test,
 * and simulations are never presented as real executions.
 */

export type ToolState =
  | "cataloged" // catalogado: conhecido e registrado, sem integração iniciada
  | "needs-config" // precisa de configuração (conta, token, projeto) antes de qualquer uso
  | "in-development" // integração/execução real em construção
  | "connected" // conectado, mas sem teste real aprovado ainda
  | "operational-tested" // teste real aprovado — único estado que autoriza uso
  | "error" // erro conhecido
  | "unavailable"; // indisponível

export type ToolCategory =
  | "design-vectors"
  | "image-photo"
  | "documents"
  | "video"
  | "research"
  | "automation"
  | "reverse-engineering"
  | "other";

export interface ToolEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ToolCategory;
  repoUrl?: string;
  website?: string;
  license?: string;
  state: ToolState;
  capabilities: string[];
  requirements: string[];
  dependencies: string[];
}

/* ------------------------------------------------------------------ */
/* FASE 4 — Modelo de 6 estados honestos (ToolHealthState).             */
/*                                                                     */
/* Regras duras:                                                       */
/* - CONNECTED ≠ READY. "Conectado" significa apenas: adapter          */
/*   registrado + configuração presente, SEM execução real aprovada.   */
/* - READY exige execução funcional REAL comprovada (histórico de       */
/*   execução com sucesso). Um adapter 501 (executionReady = false)    */
/*   NUNCA pode ser READY.                                             */
/* - O ToolState legado acima é mantido SOMENTE para compatibilidade   */
/*   com a UI existente; o modelo autoritativo é o ToolHealthState,    */
/*   derivado por evidência em lib/catalog/health.ts.                  */
/* ------------------------------------------------------------------ */

export type ToolHealthState =
  | "NOT_CONFIGURED" // configuração/credenciais necessárias ausentes
  | "CONNECTED" // adapter registrado + configurado, sem execução real aprovada
  | "READY" // execução real comprovada com sucesso — único estado que autoriza uso
  | "DEGRADED" // já executou com sucesso, mas a última execução real falhou
  | "SIMULATED" // execuções declaradamente simuladas, sem execução real
  | "ERROR"; // erro conhecido que impede o funcionamento

export const TOOL_HEALTH_STATE_LABELS: Record<ToolHealthState, string> = {
  NOT_CONFIGURED: "Não configurada",
  CONNECTED: "Conectada",
  READY: "Pronta (execução real comprovada)",
  DEGRADED: "Degradada",
  SIMULATED: "Simulada",
  ERROR: "Erro",
};

export const TOOL_HEALTH_STATE_DESCRIPTIONS: Record<ToolHealthState, string> = {
  NOT_CONFIGURED:
    "Falta configuração necessária (conta, token, projeto, executor). Nada foi conectado.",
  CONNECTED:
    "Adapter registrado e configuração presente, mas ainda sem nenhuma execução real aprovada. NÃO autoriza uso produtivo.",
  READY:
    "Executor real conectado, configurado e com execução funcional comprovada. Único estado que autoriza uso.",
  DEGRADED:
    "Já executou com sucesso antes, mas a última execução real falhou. Requer investigação antes de novo uso.",
  SIMULATED:
    "As execuções são declaradamente simuladas (demos, dry-runs). Nunca apresentadas como reais.",
  ERROR:
    "Erro conhecido que impede o funcionamento, ou execução real que falhou sem nunca ter tido sucesso.",
};

/**
 * Migração honesta do ToolState legado para o novo modelo.
 *
 * Os valores legados eram declarações; o novo modelo deriva de evidência.
 * "unavailable" não tem equivalente no modelo de 6 estados: ferramentas
 * realmente indisponíveis (ex.: bloqueadas por licença) NÃO entram no
 * catálogo. Se algum legado "unavailable" aparecer, mapeia para ERROR com
 * o motivo preservado em `reason` — nunca para um estado "saudável".
 */
export const LEGACY_STATE_TO_HEALTH: Record<ToolState, ToolHealthState> = {
  cataloged: "NOT_CONFIGURED",
  "needs-config": "NOT_CONFIGURED",
  "in-development": "NOT_CONFIGURED",
  connected: "CONNECTED",
  "operational-tested": "READY",
  error: "ERROR",
  unavailable: "ERROR",
};

export function mapLegacyStateToHealth(legacy: ToolState): ToolHealthState {
  return LEGACY_STATE_TO_HEALTH[legacy];
}

/* ------------------------------------------------------------------ */
/* FASE 4 — Facetas honestas de cada ferramenta no catálogo.           */
/* null = não especificado / desconhecido (nunca inventado).          */
/* ------------------------------------------------------------------ */

/** Manifesto técnico: fatos verificados sobre a ferramenta. */
export interface ToolTechnicalProfile {
  /** Runtime/plataforma conhecido. Ex.: "Rust", "Node.js 22+". null se desconhecido. */
  runtime: string | null;
  /** Canais de controle verificados. Ex.: ["MCP", "CLI"]. null se desconhecido. */
  controlChannels: string[] | null;
  /** Nota técnica curta, só com fatos do repositório/site oficial. */
  note: string | null;
}

/** Um campo de input/output tipado, transcrito do contrato real do adapter. */
export interface ToolIOField {
  name: string;
  type: string;
  required: boolean;
  note?: string;
}

/** Inputs/outputs tipados. null = não especificado (sem contrato conhecido). */
export interface ToolIO {
  inputs: ToolIOField[] | null;
  outputs: ToolIOField[] | null;
}

/** Registro de uma execução real conhecida. null em `history` = sem histórico. */
export interface ToolRunRecord {
  /** ISO 8601 da execução. */
  at: string;
  ok: boolean;
  /** Resumo honesto do que foi executado. */
  summary: string;
}

export interface ToolEntry {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: ToolCategory;
  repoUrl?: string;
  website?: string;
  license?: string;
  /** Estado legado — mantido para a UI; o estado autoritativo vem de health.ts. */
  state: ToolState;
  capabilities: string[];
  requirements: string[];
  dependencies: string[];
  /* --- FASE 4: facetas honestas (null = não especificado) --- */
  /** Versão da ferramenta. null = não especificada (não inventar). */
  version: string | null;
  /** Manifesto técnico (fatos verificados). */
  technicalProfile: ToolTechnicalProfile;
  /** Inputs/outputs tipados do contrato do adapter. null = não especificado. */
  io: ToolIO | null;
  /** Executor real conectado. null = nenhum (honesto). */
  executor: string | null;
  /** Permissões que a ferramenta/integração exige. null = não especificado. */
  permissions: string[] | null;
  /** Limites conhecidos (cotas, tetos, restrições). null = não especificado. */
  limits: string[] | null;
  /** Onde ficam os logs de execução. null = não especificado. */
  logs: string | null;
  /** Evidência de testes reais. null = sem testes conhecidos. */
  tests: string[] | null;
  /** Histórico de execuções reais. null = sem histórico. */
  history: ToolRunRecord[] | null;
}

export const TOOL_STATE_LABELS: Record<ToolState, string> = {
  cataloged: "Catalogado",
  "needs-config": "Aguardando configuração",
  "in-development": "Em desenvolvimento",
  connected: "Conectado",
  "operational-tested": "Operacional (testado)",
  error: "Erro",
  unavailable: "Indisponível",
};

export const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  "design-vectors": "Design e vetores",
  "image-photo": "Imagem e foto",
  documents: "Documentos",
  video: "Vídeo",
  research: "Pesquisa",
  automation: "Automação",
  "reverse-engineering": "Engenharia reversa",
  other: "Outros",
};

/** Ids of registry entries that are external SERVICES (configured in /integrations). */
export const SERVICE_IDS = ["apify-mcp", "gws-cli", "supabase", "hyperframes"] as const;
