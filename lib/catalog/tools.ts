/**
 * Tool registry — ATHENA TOOLS HUB.
 *
 * REAL DATA ONLY. Every capability listed here comes from the tool's own
 * repository/README. Nothing is invented.
 *
 * NOTE on excluded craft repos:
 * - storytold/artcraft-services is NOT a registry tool: it ships under the
 *   "ArtCraft License (WIP)" (fair-source style, NOT open source) which forbids
 *   selling the software commercially and building competing products with its
 *   code. Do not adapt its code without written permission.
 * - storytold/artcraftx is NOT a registry tool: no license could be verified
 *   (no license file in the repo, GitHub reports no license). Do not adapt.
 * See docs/CATALOG_LICENSES.md for the full verification table.
 *
 * FASE 4 — cada ferramenta expõe facetas honestas (version, technicalProfile,
 * io, executor, permissions, limits, logs, tests, history). null = não
 * especificado / desconhecido — nunca inventado. O estado autoritativo da
 * ferramenta é derivado por lib/catalog/health.ts (ToolHealthState); o campo
 * `state` legado é mantido para a UI existente.
 */

import type { ToolCategory, ToolEntry } from "./types";
import { SERVICE_IDS } from "./types";

export const TOOLS: ToolEntry[] = [
  {
    id: "vectorcraft",
    name: "VectorCraft",
    tagline:
      "Editor vetorial open-source (estilo Illustrator) em Rust, dirigível por agentes via MCP",
    description:
      "Reimplementação clean-room do Adobe Illustrator em Rust puro, mantida pelo ArtCraft team. Traz ferramentas Pen/Direct Selection, Pathfinder, camadas, tipografia com estilos, blends vivos e exportação para SVG, PDF (incluindo .ai compatível com PDF), EPS, DXF, PNG/JPEG/WebP. Pode ser operado por agentes de IA através de servidor MCP ou canal de controle JSON, além do modo headless por CLI para processamento em lote. Primeira candidata a execução real no Hub (adapter contract-first).",
    category: "design-vectors",
    repoUrl: "https://github.com/storytold/vectorcraft",
    license: "MIT OR Apache-2.0",
    state: "in-development",
    capabilities: [
      "Criação e edição vetorial através de comandos MCP",
      "Exportação para SVG, PDF, PNG, JPEG e WebP",
      "Processamento em lote headless via CLI",
      "Importação de SVG, PDF, .ai (compatível com PDF), EPS e DXF",
    ],
    requirements: [
      "Binário de release ou toolchain Rust para compilar",
      "Ambiente isolado para executar o servidor MCP/CLI (fora do frontend)",
    ],
    dependencies: [],
    version: null, // versão da ferramenta não especificada — não inventar
    technicalProfile: {
      runtime: "Rust",
      controlChannels: ["MCP", "CLI", "JSON"],
      note: "Reimplementação clean-room do Adobe Illustrator em Rust puro (equipe ArtCraft).",
    },
    // Inputs transcritos do contrato real do adapter (lib/adapters/vectorcraft.ts).
    io: {
      inputs: [
        { name: "prompt", type: "string", required: true, note: "1–4000 caracteres" },
        { name: "width", type: "number (int)", required: false, note: "16–4096" },
        { name: "height", type: "number (int)", required: false, note: "16–4096" },
        { name: "style", type: "string", required: false, note: "máx. 120 caracteres" },
      ],
      outputs: null, // executor pendente — outputs não especificados
    },
    executor: null, // nenhum executor real conectado
    permissions: null,
    limits: [
      "prompt: 1–4000 caracteres",
      "width/height: 16–4096 px",
      "executor real pendente — nenhuma execução disponível",
    ],
    logs: null, // não especificado — nenhuma execução real registrada
    tests: [
      "lib/adapters/vectorcraft.test.ts — contrato (validação de params + dry-run)",
      "execução real: não testada",
    ],
    history: null, // sem histórico de execução real
  },
  {
    id: "designcraft",
    name: "DesignCraft",
    tagline:
      "Diagramação e layout de páginas (estilo InDesign) em Rust, com MCP para agentes",
    description:
      "Reimplementação clean-room do Adobe InDesign em Rust puro. Trabalha com spreads, páginas-mãe, quadros de texto encadeados, estilos de parágrafo e caractere e composição de parágrafos. Exporta PNG, PDF (PDF/X-4, PDF/A-2b), EPUB e PowerPoint editável; importa e exporta IDML. Estágio pré-alfa segundo o roadmap do repositório. Controlável por agentes via canal JSON e servidor MCP.",
    category: "design-vectors",
    repoUrl: "https://github.com/storytold/designcraft",
    license: "MIT OR Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Diagramação de revistas e páginas através de comandos MCP",
      "Exportação para PDF, EPUB, PowerPoint editável e PNG",
      "Renderização headless de páginas via CLI",
      "Importação e exportação de IDML",
    ],
    requirements: [
      "Binário de release ou toolchain Rust para compilar",
      "Ambiente isolado para executar o servidor MCP/CLI (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Rust",
      controlChannels: ["MCP", "CLI", "JSON"],
      note: "Reimplementação clean-room do Adobe InDesign em Rust puro; estágio pré-alfa segundo o roadmap do repositório.",
    },
    io: null, // sem contrato de adapter — inputs/outputs não especificados
    executor: null,
    permissions: null,
    limits: null,
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "photocraft",
    name: "PhotoCraft",
    tagline:
      "Editor de fotos open-source (estilo Photoshop) em Rust, com 67 ferramentas",
    description:
      "Editor de fotos open-source em Rust puro — reimplementação clean-room do fluxo do Photoshop: camadas, máscaras, adjustment layers, estilos de camada, tipografia, pincéis e arquivos PSD reais (leitura e escrita). Status: alfa inicial. Cada ação é um comando: pode ser dirigido pela interface, por CLI, por canal de controle JSON ou por servidor MCP.",
    category: "image-photo",
    repoUrl: "https://github.com/storytold/photocraft",
    license: "MIT OR Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Edição fotográfica através de comandos (UI, CLI, JSON ou MCP)",
      "Leitura e escrita de arquivos PSD com camadas",
      "Operação por agentes via servidor MCP",
      "Exportação para JPG, PNG, WebP e outros formatos",
    ],
    requirements: [
      "Binário de release ou toolchain Rust para compilar",
      "Ambiente isolado para executar o servidor MCP/CLI (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Rust",
      controlChannels: ["UI", "CLI", "JSON", "MCP"],
      note: "Editor de fotos em Rust puro; lê e escreve arquivos PSD reais com camadas. Estágio alfa inicial.",
    },
    io: null,
    executor: null,
    permissions: null,
    limits: null,
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "lightcraft",
    name: "LightCraft",
    tagline:
      "Revelação RAW e biblioteca de fotos não-destrutiva (estilo Lightroom) em Rust",
    description:
      "Editor de fotos não-destrutivo e revelador RAW em Rust puro — reimplementação clean-room do fluxo do Lightroom. Pipeline de 32 bits float, ajustes de exposição/contraste/realces/sombras, color grading, máscaras locais (pincel, gradientes, céu, assunto), presets e biblioteca com álbuns, avaliações e busca. Dirigível por agentes através de CLI scriptável e servidor MCP.",
    category: "image-photo",
    repoUrl: "https://github.com/storytold/lightcraft",
    license: "MIT OR Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Revelação e ajuste de fotos através de comandos",
      "Máscaras locais: pincel, gradientes lineares/radiais, céu e assunto",
      "Biblioteca com álbuns, avaliações e busca",
      "Operação por agentes via MCP ou CLI",
    ],
    requirements: [
      "Binário de release ou toolchain Rust para compilar",
      "Ambiente isolado para executar o servidor MCP/CLI (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Rust",
      controlChannels: ["CLI", "MCP"],
      note: "Revelador RAW e biblioteca não-destrutiva em Rust puro; pipeline de 32 bits float.",
    },
    io: null,
    executor: null,
    permissions: null,
    limits: null,
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "artcraft",
    name: "ArtCraft",
    tagline:
      "IDE de criação com IA para imagem e vídeo (geração via provedores externos)",
    description:
      "Aplicativo desktop descrito como 'IDE para artistas': composição de cenas em 2D/3D, posing de personagens, transferência de identidade de personagem, remoção de fundo e geração de imagem e vídeo por prompt. A geração usa modelos de provedores externos (ArtCraft, Grok, Midjourney, Sora, World Labs, entre outros) — contas e custos desses provedores são separados e exigem aprovação prévia. Código do app sob licença dupla MIT/Apache-2.0.",
    category: "image-photo",
    repoUrl: "https://github.com/storytold/artcraft",
    website: "https://getartcraft.com",
    license: "MIT OR Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Composição de cenas em 2D e 3D com personagens e props",
      "Geração de imagem e vídeo por prompt (via provedores externos)",
      "Edição de imagem guiada por canvas, máscaras e inpainting",
      "Remoção de fundo",
    ],
    requirements: [
      "Conta e chave nos provedores de geração que forem usados",
      "Aprovação de custo por provedor antes de qualquer uso pago",
      "Aplicativo desktop (builds oficiais para Windows/macOS; Linux via compilação)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Aplicativo desktop",
      controlChannels: ["app desktop"],
      note: "IDE de criação com IA; geração de imagem/vídeo usa provedores externos (contas e custos separados). Código do app sob licença dupla MIT/Apache-2.0.",
    },
    io: null,
    executor: null,
    permissions: null,
    limits: [
      "geração de imagem/vídeo via provedores externos — contas e custos separados",
      "aprovação de custo prévia obrigatória antes de qualquer uso pago",
    ],
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "wordcraft",
    name: "WordCraft",
    tagline:
      "Processador de texto open-source (estilo Word) em Rust, com conversão por CLI",
    description:
      "Reimplementação clean-room do Microsoft Word em Rust puro: ribbon, estilos, tabelas, controle de alterações, referências e mala direta. Lê e escreve .docx (OOXML), importa .doc/.odt/.rtf/.html/.md/.tex/.txt e exporta PDF. A CLI converte documentos em lote (por exemplo docx→pdf) e o servidor MCP permite que agentes criem e editem documentos. Estágio alfa.",
    category: "documents",
    repoUrl: "https://github.com/storytold/wordcraft",
    license: "MIT OR Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Criação e edição de documentos através de comandos MCP",
      "Conversão em lote via CLI (docx→pdf/odt/rtf/html/md)",
      "Leitura e escrita de .docx com fidelidade",
      "Exportação de PDF com texto selecionável",
    ],
    requirements: [
      "Binário de release ou toolchain Rust para compilar",
      "Ambiente isolado para executar o servidor MCP/CLI (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Rust",
      controlChannels: ["MCP", "CLI"],
      note: "Reimplementação clean-room do Microsoft Word em Rust puro; lê/escreve .docx (OOXML). Estágio alfa.",
    },
    io: null,
    executor: null,
    permissions: null,
    limits: null,
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "hyperframes",
    name: "HyperFrames",
    tagline:
      "Renderizador de vídeo a partir de HTML/CSS/animação — MP4 determinístico",
    description:
      "Framework open-source da HeyGen que transforma HTML, CSS, mídia e animações em vídeos MP4 determinísticos. É uma ferramenta de produção/renderização: escreve-se a composição em HTML, visualiza-se no navegador e renderiza-se por CLI (local, nuvem HeyGen ou AWS Lambda). NÃO gera avatares de IA nativamente — não é um gerador de talking-head; é o motor que compõe o vídeo final a partir de assets prontos.",
    category: "video",
    repoUrl: "https://github.com/heygen-com/hyperframes",
    license: "Apache-2.0",
    state: "cataloged",
    capabilities: [
      "Renderização de composições HTML em MP4",
      "Fluxo de produção guiado por agentes (skills)",
      "Renderização local, em nuvem HeyGen ou AWS Lambda",
      "Pré-visualização com live reload",
    ],
    requirements: [
      "Node.js 22 ou superior",
      "FFmpeg instalado",
      "Ambiente isolado para o renderer (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Node.js 22+",
      controlChannels: ["CLI"],
      note: "Framework open-source da HeyGen: compõe MP4 determinístico a partir de HTML/CSS — NÃO gera avatares de IA nativamente.",
    },
    // Inputs transcritos do contrato real do adapter (lib/adapters/hyperframes.ts).
    io: {
      inputs: [
        { name: "model", type: "string", required: true, note: "máx. 120 caracteres" },
        { name: "format", type: "enum", required: true, note: "9:16 | 1:1 | 16:9" },
        { name: "text", type: "string", required: true, note: "texto/roteiro, 1–20000 caracteres" },
        { name: "assets", type: "string[] (URLs)", required: false, note: "máx. 20" },
        { name: "durationSeconds", type: "number (int)", required: false, note: "1–3600" },
      ],
      outputs: null, // executor pendente — outputs não especificados
    },
    executor: null,
    permissions: [
      "Renderizar composições HTML em MP4 no executor configurado",
      "Ler status e resultados de renders",
    ],
    limits: [
      "format: 9:16 | 1:1 | 16:9",
      "assets: até 20 URLs",
      "durationSeconds: 1–3600",
      "renderização em nuvem tem custo — aprovação prévia da Cristiane",
      "executor real pendente — nenhuma execução disponível",
    ],
    logs: null,
    tests: [
      "lib/adapters/hyperframes.test.ts — contrato (validação de params + dry-run)",
      "execução real: não testada",
    ],
    history: null,
  },
  {
    id: "apify-mcp",
    name: "Apify MCP",
    tagline:
      "Milhares de Actors prontos (scraping, crawling, automação) via Model Context Protocol",
    description:
      "Servidor MCP oficial da Apify que expõe milhares de Actors prontos — web scraping, crawling e extração de dados de redes sociais, e-commerce, mapas e buscadores — como ferramentas para agentes de IA. ATENÇÃO: a dona já paga a Apify via ScalaFlow — NÃO tocar nessa integração, NÃO criar novas contas. Actors somente com tetos de orçamento definidos, e tokens nunca aparecem no navegador.",
    category: "automation",
    repoUrl: "https://github.com/apify/apify-mcp-server",
    website: "https://mcp.apify.com",
    state: "needs-config",
    capabilities: [
      "Descoberta e execução de Actors da Apify Store",
      "Extração estruturada de dados da web",
      "Crawling e automação web via agentes",
    ],
    requirements: [
      "Token de API da Apify de conta EXISTENTE — não criar nova conta",
      "Tetos de gasto configurados no painel da Apify",
      "Autorização da Cristiane antes de qualquer execução paga",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Servidor MCP",
      controlChannels: ["MCP"],
      note: "Servidor MCP oficial da Apify. A integração Apify existente via ScalaFlow NÃO é tocada por este Hub.",
    },
    // Inputs transcritos do contrato real do adapter (lib/adapters/apify-mcp.ts).
    io: {
      inputs: [
        { name: "actor", type: "string", required: true, note: "Actor permitido, máx. 200 caracteres" },
        { name: "params", type: "record<string, unknown>", required: false, note: "padrão: {}" },
        { name: "maxCostCents", type: "number (int)", required: true, note: "teto de gasto obrigatório, ≥ 1" },
      ],
      outputs: null, // executor pendente — outputs não especificados
    },
    executor: null,
    permissions: [
      "Executar Actors da Apify Store dentro do teto de orçamento",
      "Ler resultados e status de execuções",
      "Consultar uso e custos da conta",
    ],
    limits: [
      "maxCostCents ≥ 1 obrigatório — sem teto, a execução nem é validada",
      "usar somente a conta existente — não criar nova conta",
      "não tocar na integração Apify existente via ScalaFlow",
      "autorização da Cristiane antes de qualquer execução paga",
      "executor MCP isolado pendente — nenhuma execução disponível",
    ],
    logs: null,
    tests: [
      "lib/adapters/apify-mcp.test.ts — contrato (validação de params + dry-run)",
      "execução real: não testada",
    ],
    history: null,
  },
  {
    id: "playwright-cli",
    name: "Playwright CLI",
    tagline:
      "Automação de navegador real (navegar, clicar, preencher) voltada a agentes de IA",
    description:
      "CLI oficial da Microsoft sobre o Playwright para que agentes de IA controlem um navegador de verdade: navegar, inspecionar páginas, clicar, preencher formulários e extrair conteúdo. Útil para automações web, testes e coleta de dados em páginas que exigem JavaScript.",
    category: "automation",
    repoUrl: "https://github.com/microsoft/playwright-cli",
    state: "cataloged",
    capabilities: [
      "Navegação e interação com páginas reais",
      "Snapshots estruturados para agentes",
      "Extração de conteúdo de páginas dinâmicas",
    ],
    requirements: [
      "Node.js e navegadores do Playwright instalados",
      "Ambiente isolado para execução (fora do frontend)",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Node.js",
      controlChannels: ["CLI"],
      note: "CLI oficial da Microsoft sobre o Playwright para agentes de IA.",
    },
    io: null,
    executor: null,
    permissions: null,
    limits: null,
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "gws-cli",
    name: "Google Workspace CLI",
    tagline: "CLI (gws) para Drive, Gmail, Calendar, Sheets, Docs, Chat e Admin",
    description:
      "Ferramenta de linha de comando que dá acesso estruturado (JSON) ao Drive, Gmail, Calendar, Sheets, Docs, Chat e Admin do Google Workspace, construída a partir do Google Discovery Service e com skills para agentes de IA. NÃO assumir que é um produto oficial do Google — é um projeto da equipe de desenvolvedores, pré-v1.0 e em desenvolvimento ativo.",
    category: "automation",
    repoUrl: "https://github.com/googleworkspace/cli",
    state: "cataloged",
    capabilities: [
      "Listar e gerenciar arquivos do Drive",
      "Ler e enviar e-mails do Gmail",
      "Consultar e criar eventos do Calendar",
      "Criar e editar planilhas e documentos",
    ],
    requirements: [
      "Conta Google e projeto no Google Cloud com credenciais OAuth",
      "Autenticação via OAuth (gws auth setup / gws auth login)",
      "Aprovação da Cristiane para ações de escrita",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: null, // não especificado — não inventar
      controlChannels: ["CLI"],
      note: "CLI a partir do Google Discovery Service, com skills para agentes. NÃO é produto oficial do Google — projeto da equipe de desenvolvedores, pré-v1.0.",
    },
    io: null,
    executor: null,
    permissions: [
      "Ler Drive, Gmail e Calendar conforme os escopos configurados",
      "Escrever somente nos escopos aprovados pela Cristiane",
    ],
    limits: [
      "autenticação OAuth exige projeto no Google Cloud com credenciais",
      "escopos de escrita exigem aprovação explícita da Cristiane",
    ],
    logs: null,
    tests: null,
    history: null,
  },
  {
    id: "supabase",
    name: "Supabase",
    tagline: "Backend Postgres gerenciado: banco, auth e storage para o Hub",
    description:
      "Plataforma backend open-source sobre Postgres (banco de dados, autenticação e storage). REGRA DURA: não criar nem conectar nenhum projeto sem a Cristiane confirmar que existe projeto dedicado ao Tools Hub; nunca reutilizar o banco de outro produto sem isolamento total e autorização expressa.",
    category: "other",
    website: "https://supabase.com",
    state: "needs-config",
    capabilities: [
      "Banco Postgres gerenciado",
      "Autenticação de usuários",
      "Storage de arquivos",
    ],
    requirements: [
      "Confirmação da Cristiane sobre o projeto dedicado ao Tools Hub",
      "Isolamento total em relação a bancos de outros produtos",
    ],
    dependencies: [],
    version: null,
    technicalProfile: {
      runtime: "Postgres gerenciado (SaaS)",
      controlChannels: ["API"],
      note: "Plataforma backend open-source sobre Postgres (banco, autenticação, storage).",
    },
    io: null,
    executor: null,
    permissions: [
      "Leitura e escrita no banco do projeto dedicado",
      "Gerenciar autenticação de usuários",
      "Gerenciar arquivos no storage",
    ],
    limits: [
      "não criar nem conectar projeto sem a Cristiane confirmar o projeto dedicado ao Tools Hub",
      "nunca reutilizar o banco de outro produto sem isolamento total e autorização expressa",
    ],
    logs: null,
    tests: null,
    history: null,
  },
];

export function getTool(id: string): ToolEntry | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function isService(id: string): boolean {
  return (SERVICE_IDS as readonly string[]).includes(id);
}

export function getServices(): ToolEntry[] {
  return TOOLS.filter((t) => isService(t.id));
}

export function toolsByCategory(category: ToolCategory): ToolEntry[] {
  return TOOLS.filter((t) => t.category === category);
}

export function relatedTools(tool: ToolEntry, limit = 3): ToolEntry[] {
  return TOOLS.filter((t) => t.id !== tool.id && t.category === tool.category).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Config form definitions per service (integrations pages).           */
/* Fields are descriptive only: nothing is stored until the API route  */
/* exists. The UI must say so honestly instead of faking a save.       */
/* ------------------------------------------------------------------ */

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select";
  placeholder?: string;
  options?: string[];
  hint?: string;
}

export interface ServiceConfig {
  fields: ConfigField[];
  permissions: string[];
  notes: string[];
}

export const SERVICE_CONFIG: Record<string, ServiceConfig> = {
  "apify-mcp": {
    fields: [
      {
        key: "apiToken",
        label: "Token de API (conta existente)",
        type: "password",
        placeholder: "••••••••",
        hint: "Nunca cole o token no chat. Use o cofre de segredos quando disponível.",
      },
      {
        key: "budgetCapUsd",
        label: "Teto mensal de gasto (USD)",
        type: "number",
        placeholder: "10",
        hint: "Obrigatório: nenhum Actor roda sem teto de orçamento definido.",
      },
      {
        key: "defaultActor",
        label: "Actor padrão (opcional)",
        type: "text",
        placeholder: "apify/rag-web-browser",
      },
    ],
    permissions: [
      "Executar Actors da Apify Store dentro do teto de orçamento",
      "Ler resultados e status de execuções",
      "Consultar uso e custos da conta",
    ],
    notes: [
      "A dona já paga a Apify via ScalaFlow — não tocar nessa integração.",
      "Não criar novas contas; usar somente a conta existente.",
      "Tokens ficam no servidor (cofre) — nunca no navegador.",
    ],
  },
  "gws-cli": {
    fields: [
      {
        key: "authMode",
        label: "Modo de autenticação",
        type: "select",
        options: ["OAuth (conta Google)", "Service account"],
        hint: "OAuth exige projeto no Google Cloud com credenciais configuradas.",
      },
      {
        key: "allowedScopes",
        label: "Escopos permitidos",
        type: "text",
        placeholder: "drive.readonly, gmail.readonly, calendar",
        hint: "Escopos de escrita exigem aprovação explícita da Cristiane.",
      },
    ],
    permissions: [
      "Ler Drive, Gmail e Calendar conforme os escopos configurados",
      "Escrever somente nos escopos aprovados pela Cristiane",
    ],
    notes: [
      "Não é um produto oficial do Google — projeto da equipe de desenvolvedores, pré-v1.0.",
      "Credenciais OAuth ficam no servidor — nunca no navegador.",
    ],
  },
  supabase: {
    fields: [
      {
        key: "projectUrl",
        label: "URL do projeto",
        type: "text",
        placeholder: "https://xxxx.supabase.co",
      },
      {
        key: "anonKey",
        label: "Chave anônima (anon)",
        type: "password",
        placeholder: "••••••••",
      },
      {
        key: "serviceRoleKey",
        label: "Chave service_role (somente servidor)",
        type: "password",
        placeholder: "••••••••",
        hint: "Nunca expor no frontend.",
      },
    ],
    permissions: [
      "Leitura e escrita no banco do projeto dedicado",
      "Gerenciar autenticação de usuários",
      "Gerenciar arquivos no storage",
    ],
    notes: [
      "Não conectar sem a Cristiane confirmar o projeto dedicado ao Tools Hub.",
      "Nunca reutilizar o banco de outro produto sem isolamento total e autorização.",
    ],
  },
  hyperframes: {
    fields: [
      {
        key: "renderMode",
        label: "Modo de renderização",
        type: "select",
        options: ["Local", "Nuvem HeyGen", "AWS Lambda"],
        hint: "Renderização pesada roda em ambiente isolado — nada no frontend.",
      },
      {
        key: "cloudApiKey",
        label: "Chave de API da nuvem (opcional)",
        type: "password",
        placeholder: "••••••••",
        hint: "Somente se o modo de renderização em nuvem for usado.",
      },
    ],
    permissions: [
      "Renderizar composições HTML em MP4 no executor configurado",
      "Ler status e resultados de renders",
    ],
    notes: [
      "HyperFrames renderiza vídeo a partir de HTML — não gera avatares de IA.",
      "Renderização em nuvem tem custo: aprovação prévia da Cristiane.",
    ],
  },
};

export const RE_ANALYSIS_TYPES = [
  "Análise de arquivo / binário",
  "Análise de site / página",
  "Análise de API / tráfego",
  "Engenharia de formato de arquivo",
] as const;

export const RE_MAX_UPLOAD_MB = 25;
