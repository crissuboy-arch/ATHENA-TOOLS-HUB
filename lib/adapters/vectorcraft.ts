/**
 * Athena Tools Hub — adapter VectorCraft (contract-first, worker-only).
 *
 * LICENÇA CONFIRMADA: MIT OR Apache-2.0 — o repo storytold/vectorcraft traz
 * LICENSE-MIT + LICENSE-APACHE (badge "MIT OR Apache-2.0"; a API do
 * GitHub reporta Apache-2.0). Status do projeto: alfa (2026-10-10).
 * Verificado no README do repositório em 2026-10-18.
 *
 * CONTRATO REAL CONFIRMADO (README do repo — nada inventado):
 * - `vectorcraft-cli mcp` — servidor MCP (stdio) para agentes; opcional:
 *   `--automation-read-root <dir> --automation-write-root <dir>` para
 *   confinar o agente aos ficheiros do projeto.
 * - `vectorcraft-cli run --in <doc.vectorcraft> --export <out.pdf|svg|png…>`
 *   — processamento headless em lote.
 * - App desktop: `vectorcraft -- --control 7979` — canal de controle JSON.
 * Detalhes: docs/mcp.md e docs/control-protocol.md no repositório.
 *
 * DESENHO PARA WORKER ISOLADO (regra dura do Hub): o binário Rust/MCP
 * nunca corre no frontend nem no servidor principal. `buildCliJobSpec()`
 * e `buildMcpServerSpec()` produzem as especificações puras que o worker
 * executa; `execute()` lança 501 até o worker estar ligado — nenhuma
 * execução simulada.
 *
 * VectorCraft é a primeira candidata a execução real (decisão da Cristiane).
 * Quando o worker estiver pronto, este arquivo ganha a ligação real e
 * `executionReady` passa a true.
 */

import { z } from "zod";
import { HubError } from "../errors";
import {
  toolRegistry,
  type DryRunInfo,
  type ToolContract,
  type ValidationResult,
} from "./types";

/** Formatos de exportação suportados pelo renderer do VectorCraft. */
export const VECTORCRAFT_EXPORT_FORMATS = [
  "svg",
  "pdf",
  "png",
  "jpeg",
  "webp",
] as const;
export type VectorCraftExportFormat =
  (typeof VECTORCRAFT_EXPORT_FORMATS)[number];

/** Params aceitos pelo contrato inicial do VectorCraft. */
const vectorCraftParamsSchema = z
  .object({
    prompt: z.string().min(1, "prompt é obrigatório.").max(4000),
    width: z.number().int().min(16).max(4096).optional(),
    height: z.number().int().min(16).max(4096).optional(),
    style: z.string().max(120).optional(),
  })
  .passthrough();

/** Configuração do executor — só via ambiente do worker, nunca hardcoded. */
export interface VectorCraftConfig {
  configured: boolean;
  /** Caminho do binário `vectorcraft-cli` no worker. */
  binaryPath?: string;
  readRoot?: string;
  writeRoot?: string;
  reason?: string;
}

export function resolveVectorCraftConfig(
  env: Record<string, string | undefined> = process.env,
): VectorCraftConfig {
  const binaryPath = (env["VECTORCRAFT_CLI"] ?? "").trim();
  if (!binaryPath) {
    return {
      configured: false,
      reason:
        "VECTORCRAFT_CLI não definido — binário vectorcraft-cli indisponível",
    };
  }
  return {
    configured: true,
    binaryPath,
    readRoot: (env["VECTORCRAFT_READ_ROOT"] ?? "").trim() || undefined,
    writeRoot: (env["VECTORCRAFT_WRITE_ROOT"] ?? "").trim() || undefined,
  };
}

/**
 * Spec pura do job headless para o worker isolado:
 * `vectorcraft-cli run --in <doc> --export <out>`.
 * O documento .vectorcraft de entrada é materializado pelo worker
 * (via servidor MCP) a partir do prompt — o Hub nunca inventa o doc.
 */
export interface VectorCraftCliJobSpec {
  mustRunOn: "isolated-worker";
  binary: string;
  args: string[];
  timeoutMs: number;
}

export function buildCliJobSpec(
  config: VectorCraftConfig,
  inputDoc: string,
  outputPath: string,
  format: VectorCraftExportFormat,
): VectorCraftCliJobSpec {
  if (!config.configured || !config.binaryPath) {
    throw HubError.notImplemented(
      `vectorcraft-cli não configurado: ${config.reason ?? "sem binário"}`,
    );
  }
  if (!inputDoc) throw HubError.validation("inputDoc é obrigatório.");
  if (!outputPath.toLowerCase().endsWith(`.${format}`)) {
    throw HubError.validation(
      `outputPath deve terminar com .${format} (formato pedido: ${format}).`,
    );
  }
  return {
    mustRunOn: "isolated-worker",
    binary: config.binaryPath,
    args: ["run", "--in", inputDoc, "--export", outputPath],
    timeoutMs: 5 * 60 * 1000,
  };
}

/**
 * Spec pura do servidor MCP para o worker isolado:
 * `vectorcraft-cli mcp [--automation-read-root R --automation-write-root W]`
 * (stdio — o worker faz o bridge MCP).
 */
export interface VectorCraftMcpServerSpec {
  mustRunOn: "isolated-worker";
  command: string;
  args: string[];
  transport: "stdio";
}

export function buildMcpServerSpec(
  config: VectorCraftConfig,
): VectorCraftMcpServerSpec {
  if (!config.configured || !config.binaryPath) {
    throw HubError.notImplemented(
      `vectorcraft-cli não configurado: ${config.reason ?? "sem binário"}`,
    );
  }
  const args = ["mcp"];
  if (config.readRoot) args.push("--automation-read-root", config.readRoot);
  if (config.writeRoot) args.push("--automation-write-root", config.writeRoot);
  return {
    mustRunOn: "isolated-worker",
    command: config.binaryPath,
    args,
    transport: "stdio",
  };
}

export class VectorCraftAdapter implements ToolContract {
  readonly id = "vectorcraft";
  readonly version = "0.2.0-contract";
  readonly capabilities = ["vector.generate"];
  /** Executor real ainda não conectado — estado honesto. */
  readonly executionReady = false;

  validateParams(params: unknown): ValidationResult {
    const result = vectorCraftParamsSchema.safeParse(params);
    if (result.success) return { ok: true, errors: [] };
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "params"}: ${i.message}`,
      ),
    };
  }

  dryRunInfo(): DryRunInfo {
    return {
      // Geração de arte exige aprovação humana até o executor ser validado.
      requiresApproval: true,
      estimatedCost: "a definir (executor em desenvolvimento)",
    };
  }

  /**
   * Execução real — AINDA NÃO LIGADA.
   * O binário roda num worker isolado (ver buildCliJobSpec /
   * buildMcpServerSpec). Lança 501 em vez de simular qualquer resultado.
   */
  async execute(): Promise<never> {
    throw HubError.notImplemented(
      "executor em desenvolvimento — o binário vectorcraft-cli roda num " +
        "worker isolado ainda não ligado; nenhuma execução simulada",
    );
  }
}

/** Registra o adapter no registry global. Importar este módulo = registrar. */
toolRegistry.register(new VectorCraftAdapter());
