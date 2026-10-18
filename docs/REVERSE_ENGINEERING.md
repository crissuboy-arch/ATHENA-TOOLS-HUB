# Engenharia Reversa — FASE 5

Módulo `lib/re/`: pipeline de análise técnica de artefactos digitais por
**análise estática isolada**. O artefacto nunca é executado.

> Estado honesto: o motor `static-local` está **READY** (provado pela suíte
> `vitest` de `lib/re`, que executa o sandbox de verdade). A integração com o
> projeto **REA** está **NOT_CONFIGURED** — ver secção 1.

---

## 1. O projeto REA — o que foi confirmado (2026-10-18)

Pesquisa web em múltiplas fontes independentes (AgentsPulse, devpik,
meta-quantum.today, ailetter.ai.kr, elsolitario.org, dev.to, AlphaSignal).

**Confirmado:**

| Aspeto | Resultado |
|---|---|
| Identidade | **REA — Reverse Engineer Anything**: servidor MCP + CLI open-source que permite a agentes de IA analisar software sem código-fonte |
| Licença | **MIT** |
| Distribuição | Pacote npm **`rea-agents`** (`npx rea-agents setup`) |
| Fontes oficiais citadas | `github.com/morluto/rea`, `rea.tools` |
| Modelo | **Ponte, não um novo descompilador**: liga o agente a motores existentes (Ghidra, IDA Pro, Hopper, JADX, Binwalk…) e devolve resultados estruturados com evidência |
| Localidade | A análise corre localmente; os binários não são enviados a terceiros (o agente é que envia resultados ao seu provider de modelo) |
| Alvos sem descompilador | JavaScript/Electron e .NET: análise estática só com Node.js |

**Requisitos de motores externos por alvo** (segundo a documentação do projeto):

| Alvo | Requisito |
|---|---|
| Binários nativos (ELF, PE, Mach-O) | Hopper, Ghidra **ou** IDA Pro (Ghidra gratuito; Hopper/IDA pagos) |
| JavaScript / Electron / .NET | Apenas Node.js |
| APKs Android | JADX headless + JDK completo |
| Capturas de rede | HAR/SAZ; `mitmdump` no Linux |

**NÃO verificado** (marcado honestamente como tal em `lib/re/engines.ts`):

- Instalação do pacote `rea-agents` neste ambiente (não executada).
- Compatibilidade da API/CLI do REA com este módulo (nenhum teste real).
- Disponibilidade de Ghidra / IDA / Hopper / JDK neste servidor.
- Comportamento de sandbox e limites do REA sob os nossos limites.

**Nota de segurança:** em 2026-10-10 surgiu um repositório *look-alike* —
instalar **apenas** das fontes oficiais acima.

**Decisão de arquitetura:** o módulo `lib/re/` **não depende do REA**.
Foi desenhado sobre análise estática local isolada (dependência zero além do
Node). O REA fica registado como motor futuro (`engines.ts`, estado
`NOT_CONFIGURED`); `requireReaEngine()` lança `NOT_IMPLEMENTED` em vez de
simular. A integração real exige: instalação do pacote das fontes oficiais +
motores externos + teste real aprovado — tudo com autorização da Cristiane.

---

## 2. Arquitetura do pipeline

```
upload autorizado
      │  AnalyzeInput { filename, bytes, analysisType, authorized }
      ▼
┌─────────────┐
│ VALIDAÇÃO    │  magic bytes (nunca a extensão) · tamanho · formatos
│ (pura)       │  permitidos · anti-spoofing · quarentena
└──────┬──────┘
       │ ok → job RECEIVED → VALIDATING → QUEUED
       ▼
┌─────────────┐
│ SANDBOX      │  subprocesso node isolado:
│ (isolada)    │  dir temporário descartável · timeout+SIGKILL ·
└──────┬──────┘  --max-old-space-size · ulimit -v/-t/-f ·
       │         env mínimo sem segredos · cwd descartável · sem rede
       ▼
┌─────────────┐
│ WORKER       │  lib/re/worker/analyze.mjs (só builtins do Node):
│ (estático)   │  sha256 · entropia · strings (UTF-8) · estrutura por
└──────┬──────┘  formato · dependências declaradas → report.json
       │ job RUNNING → COMPLETED (ou REJECTED / FAILED)
       ▼
  ReReport + artefactos [report.json, strings.txt, manifest.json]
```

Ficheiros:

| Ficheiro | Papel |
|---|---|
| `lib/re/types.ts` | Tipos públicos; estados honestos; contrato `WorkerReport` |
| `lib/re/config.ts` | `DEFAULT_LIMITS`, `HARD_CEILINGS`, `resolveLimits()` (clamp transparente) |
| `lib/re/magic.ts` | Deteção por magic bytes (fonte única: `worker/signatures.json`) |
| `lib/re/validation.ts` | Validação + quarentena (pura, sem I/O) |
| `lib/re/sandbox.ts` | `runIsolated()` — subprocesso com limites |
| `lib/re/worker/analyze.mjs` | Extração estática (corre SEMPRE isolado) |
| `lib/re/worker/signatures.json` | Tabela de magic bytes (fonte única) |
| `lib/re/pipeline.ts` | `analyzeArtifact()` — orquestração + máquina de estados do job |
| `lib/re/engines.ts` | Registo de motores; `REA_VERIFICATION`; barreira `requireReaEngine()` |
| `lib/re/index.ts` | API pública (para o motor da FASE 3) |

O motor da FASE 3 (`lib/jobs`, fora do escopo desta fase) orquestra chamando
`analyzeArtifact(input, { limits })` e persiste `ReJob`/`ReReport`/`ReArtifact`.

---

## 3. Limites rígidos

Defaults conservadores (`DEFAULT_LIMITS`); overrides nunca passam dos tetos
(`HARD_CEILINGS`) — valores acima são **reduzidos** e listados em
`report.clamped` (transparência, não rejeição silenciosa).

| Limite | Default | Teto rígido | Mecanismo |
|---|---|---|---|
| `maxUploadBytes` | 25 MB (= `RE_MAX_UPLOAD_MB` do catálogo) | 100 MB | validação prévia |
| `maxExtractedBytes` | 10 MB | 200 MB | truncagem do relatório no worker |
| `timeoutMs` | 60 s | 300 s | timer + SIGKILL |
| `maxMemoryBytes` | 512 MB | 2 GB | `--max-old-space-size` (75%) |
| `maxCpuSeconds` | 60 s | 300 s | `ulimit -t` |
| `maxDiskBytes` | 100 MB | 1 GB | `ulimit -f` |
| `maxStrings` | 5 000 | 50 000 | amostra no worker |
| `minStringLength` | 4 | 64 | filtro no worker |
| `maxStringsBytes` | 1 MB | 10 MB | teto do bloco de strings |

**Não existe opção de rede.** Por desenho, `ReLimits` não tem nenhum campo
para a habilitar — a análise é sempre offline.

Memória em duas camadas (verificado empiricamente): um `ulimit -v` apertado
mata o Node no arranque (V8 precisa de reserva virtual folgada), por isso o
limite **real** é o heap (`--max-old-space-size` = 75% de `maxMemoryBytes`,
mínimo 64 MB) e o `ulimit -v` é um backstop generoso (mínimo 2 GB).

---

## 4. Quarentena

Ordem rígida; a primeira falha vence. Ficheiro suspeito → **rejeitado com
motivo, nunca executado**. Mensagens de erro nunca incluem conteúdo do ficheiro.

| Código | Quando | Quarentena |
|---|---|---|
| `AUTHORIZATION_REQUIRED` | `authorized !== true` | não (rejeição prévia) |
| `INVALID_FILENAME` | vazio, >255 chars, `/`, `\`, `..` | não |
| `EMPTY_FILE` | 0 bytes | não |
| `TOO_LARGE` | acima de `maxUploadBytes` | não |
| `UNKNOWN_FORMAT` | magic bytes irreconhecíveis | **sim** |
| `FORMAT_NOT_ALLOWED` | fora de `allowedKinds` | **sim** |
| `EXTENSION_SPOOF` | extensão ≠ formato real (ou sem extensão) | **sim** |
| `DOUBLE_EXTENSION` | ex.: `relatorio.pdf.exe` | **sim** |
| `MALWARE_SIGNATURE` | string de teste EICAR | **sim** |
| `SANDBOX_TIMEOUT` | excedeu `timeoutMs` | não (processo morto, dir descartado) |
| `ANALYSIS_FAILED` | worker falhou / contrato violado / divergência de sha256 | não |

Anti-bypass testado: binário PE nomeado `foto.png` → `EXTENSION_SPOOF`;
`relatorio.pdf.exe` (PE real) → `DOUBLE_EXTENSION`; EICAR → `MALWARE_SIGNATURE`.

---

## 5. Sandbox — garantias e limitações honestas

**Garante** (testado): diretório temporário descartável por execução;
timeout com SIGKILL; heap V8 limitado; `ulimit -t`/`-f`; ambiente do filho com
PATH restrito e **zero** variáveis do pai (segredos nunca atravessam);
allowlist rígida — só o binário `node` atual é executado; stdout/stderr com
teto de captura (1 MB); ficheiros de saída recolhidos antes do descarte.

**Limitações honestas:**

- **Não é um namespace de rede isolado** (sem `unshare`/firejail). A garantia
  "sem rede" vem de o worker **não conter nenhuma API de rede** — verificado
  por teste estático (`sandbox.test.ts` > "auto-verificação anti-rede").
- Em plataformas não-POSIX os `ulimit` são ignorados (só o timeout se aplica).
- Isolamento de rede a nível de kernel (netns/firejail) está marcado como
  trabalho futuro — **NÃO VERIFICADO** neste ambiente.

---

## 6. Operação

```ts
import { analyzeArtifact } from "@/lib/re";

const outcome = await analyzeArtifact(
  {
    filename: "cliente.apk",
    bytes, // Uint8Array
    analysisType: "Análise de arquivo / binário",
    authorized: true, // artefacto próprio ou autorização expressa do titular
    submittedBy: "user-uuid",
  },
  { limits: { timeoutMs: 120_000 } }, // opcional; clampado aos tetos
);

if (outcome.ok) {
  // outcome.job (COMPLETED), outcome.report, outcome.artifacts
} else {
  // outcome.job (REJECTED/FAILED), outcome.rejection { code, reason, quarantine }
}
```

Correr os gates desta fase:

```bash
npx vitest run lib/re
npx tsc --noEmit
```

Pré-requisito operacional: `TMPDIR` com espaço livre — o sandbox cria
diretórios temporários via `os.tmpdir()` (ver `docs`: o `/tmp` deste servidor
é um tmpfs pequeno partilhado; definir `TMPDIR` noutro volume quando necessário).

---

## 7. Avisos legais (leitura obrigatória antes de operar)

1. **Só analisar artefactos próprios ou com autorização expressa do titular.**
   A UI já exibe este aviso; o pipeline exige `authorized: true` e rejeita
   sem ele (`AUTHORIZATION_REQUIRED`).
2. **Proibido contornar** DRM, licenças, autenticação, controlos de acesso ou
   outras proteções técnicas — este módulo faz apenas **análise estática de
   artefactos autorizados** (ler bytes, nunca executar, nunca "destravar").
3. Respeitar EULAs/ToS do software analisado e a legislação aplicável
   (incl. LGPD para dados pessoais eventualmente presentes nos artefactos).
4. A deteção EICAR é uma **assinatura de teste** da indústria antivírus, não
   um antivírus: não substitui análise de malware profissional.
5. Entropia alta (>7.2) é **indício** de compressão/encriptação/ofuscação,
   não prova de malícia.
6. O motor REA (quando integrado) tem caminhos com execução/attach ao alvo —
   usar só análise estática até existir sandbox dedicada aprovada.

---

## 8. Trabalho futuro (não iniciado)

- Integração REA: instalar `rea-agents` das fontes oficiais + motor externo
  (Ghidra) + teste real aprovado + autorização da Cristiane.
- Isolamento de rede a nível de kernel (netns) para o sandbox.
- Persistência de jobs/relatórios via Supabase (com o motor da FASE 3).
- Endpoint `POST /api/v1/re-jobs` (a UI está honestamente desativada até lá).
