/**
 * Athena Tools Hub — registro central de adapters.
 *
 * Importar este módulo registra todos os adapters disponíveis no
 * `toolRegistry`. Route handlers e o job service importam daqui
 * (nunca de arquivos individuais) para garantir registro completo.
 */

import "./vectorcraft";
import "./hyperframes";
import "./apify-mcp";

export { toolRegistry } from "./types";
export type { ToolContract, ValidationResult, DryRunInfo } from "./types";
