/**
 * Athena Tools Hub — FASE 5: registo de motores de análise.
 *
 * Estado honesto por omissão: nenhum motor nasce READY sem teste real.
 *  - "static-local": análise estática isolada deste módulo — READY porque a
 *    suíte vitest de lib/re a executa de verdade (sandbox + worker).
 *  - "rea": integração com o projeto REA — NOT_CONFIGURED. Ver secção
 *    REA_VERIFICATION e docs/REVERSE_ENGINEERING.md.
 */

import { HubError } from "../errors";
import type { ReEngine } from "./types";

/**
 * O que foi confirmado sobre o REA em 2026-10-18 (pesquisa web, múltiplas
 * fontes independentes) — e o que NÃO foi.
 */
export const REA_VERIFICATION = {
  verifiedAt: "2026-10-18",
  project: "REA — Reverse Engineer Anything",
  confirmed: [
    "Identidade: servidor MCP + CLI open-source para agentes de IA analisarem software sem código-fonte.",
    "Licença: MIT.",
    "Distribuição: pacote npm `rea-agents` (instalação via `npx rea-agents setup`).",
    "Repositório oficial citado: github.com/morluto/rea; site: rea.tools.",
    "Modelo: ponte entre o agente e motores existentes — NÃO é um novo descompilador e não os substitui.",
    "Análise local: os binários não são enviados para terceiros (o agente é que envia resultados ao seu provider).",
  ],
  engineRequirements: [
    "Binários nativos (ELF/PE/Mach-O): Hopper, Ghidra OU IDA Pro (Ghidra gratuito; Hopper/IDA pagos).",
    "JavaScript/Electron/.NET: apenas Node.js (sem descompilador).",
    "APKs Android: JADX headless + JDK completo.",
    "Capturas de rede: HAR/SAZ; mitmdump no Linux.",
  ],
  notVerified: [
    "Instalação do pacote `rea-agents` neste ambiente (não executada).",
    "Compatibilidade da API/CLI com este módulo (nenhum teste real).",
    "Disponibilidade de Ghidra/IDA/Hopper/JDK neste servidor (não verificada).",
    "Comportamento de sandbox/recursos do REA sob os nossos limites.",
  ],
  securityNotes: [
    "Em 2026-10-10 surgiu um repositório look-alike — instalar APENAS das fontes oficiais.",
    "Caminhos com execução/attach ao alvo têm efeitos colaterais: usar só análise estática até haver sandbox dedicada.",
  ],
} as const;

/** Data da última prova real do motor static-local (suíte lib/re). */
const STATIC_LOCAL_VERIFIED_AT = "2026-10-18";

export function listEngines(): ReEngine[] {
  return [
    {
      id: "static-local",
      name: "Análise estática local isolada",
      status: "READY",
      capabilities: [
        "Deteção de formato por magic bytes",
        "Metadados (sha256, entropia, dimensões, versões)",
        "Extração de strings ASCII",
        "Estrutura de ZIP (incl. manifestos), PE, ELF, Mach-O, PNG, PDF, JS, JSON",
        "Dependências declaradas (imports JS, package.json, requirements.txt, pom.xml)",
      ],
      requirements: ["Node.js (runtime atual)", "ambiente POSIX para ulimits (opcional)"],
      lastVerifiedAt: STATIC_LOCAL_VERIFIED_AT,
      notes:
        "Executa sempre em subprocesso isolado (sandbox.ts): timeout, ulimit " +
        "de memória/CPU/disco, diretório descartável, ambiente sem segredos, " +
        "sem rede. Estado READY sustentado pela suíte vitest de lib/re.",
    },
    {
      id: "rea",
      name: "REA (Reverse Engineer Anything) — integração futura",
      status: "NOT_CONFIGURED",
      capabilities: [
        "Ponte MCP/CLI para Ghidra, IDA Pro, Hopper",
        "Análise de binários nativos, Electron, .NET, APKs, firmware, web",
      ],
      requirements: REA_VERIFICATION.engineRequirements as unknown as string[],
      notes:
        "Projeto confirmado como existente e MIT em 2026-10-18 (ver REA_VERIFICATION), " +
        "mas NENHUM teste real foi executado neste ambiente: pacote não instalado, " +
        "motores não verificados, API não validada. Qualquer chamada falha com " +
        "NOT_IMPLEMENTED até configuração + teste real aprovados.",
    },
  ];
}

export function getEngine(id: "static-local" | "rea"): ReEngine {
  const engine = listEngines().find((e) => e.id === id);
  if (!engine) throw HubError.notFound("Motor de análise");
  return engine;
}

/**
 * Barreira honesta: a integração REA não existe ainda. Lança sempre
 * HubError NOT_IMPLEMENTED — nunca simula sucesso.
 */
export function requireReaEngine(): never {
  throw HubError.notImplemented(
    "Motor REA não configurado: pacote `rea-agents` não instalado e nenhum " +
      "teste real executado (estado NOT_CONFIGURED desde 2026-10-18). " +
      "Ver docs/REVERSE_ENGINEERING.md para o plano de integração.",
  );
}
