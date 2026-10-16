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
