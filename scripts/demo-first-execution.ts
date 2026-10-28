/**
 * Athena Tools Hub — HARNESS ISOLADO da primeira execução real (HyperFrames).
 *
 * O QUE CORRE AQUI (sem mocks no caminho de execução):
 *   seed job QUEUED → Worker real (lib/jobs/worker.ts) → claim atómico →
 *   adapter HyperFrames real → execute() real (lint → render → ffprobe →
 *   artefacto) → COMPLETED → consulta via store.get (o mesmo formato que
 *   a API devolve em produção via service.getJob).
 *
 * O QUE NÃO CORRE AQUI (declarado, não escondido):
 *   - NADA contra a base viva Supabase: a store é MemoryJobStore. A base
 *     viva exige sessão/chave da dona e não é alcançável por agentes.
 *   - NÃO passa pela rota HTTP nem pela aprovação humana (PENDING_APPROVAL):
 *     o job é semeado já em QUEUED, como ficaria APÓS aprovação — o fluxo
 *     criação→aprovação→fila já existe e é testado (service.createJob).
 *
 * Provas extra incluídas: isolamento por org (job de outra org fica
 * QUEUED) e idempotência (após COMPLETED, novos ticks NÃO reexecutam —
 * execution_completed continua 1).
 *
 * Arranque:
 *   HYPERFRAMES_WORKER_ENABLED=1 \
 *   HYPERFRAMES_CLI=<.../hyperframes/dist/cli.js> \
 *   HYPERFRAMES_BROWSER_PATH=<.../chrome> \
 *   HYPERFRAMES_ARTIFACTS_DIR=<dir> \
 *   node_modules/.bin/vite-node scripts/demo-first-execution.ts
 *
 * Exit 0 = tarefa real concluída com artefacto verificado. Qualquer outro
 * exit = bloqueio/falha, com o motivo impresso (nunca "concluído" falso).
 */

import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import "../lib/adapters/index";
import { toolRegistry } from "../lib/adapters/index";
import { MemoryJobStore } from "../lib/jobs/memory-store";
import { Worker } from "../lib/jobs/worker";

const DEMO_ORG = "org-demo-primeira-execucao";
const OTHER_ORG = "org-outra-isolamento";
const DEMO_JOB_ID = "job-demo-hf-001";
const OTHER_JOB_ID = "job-outra-org-001";

// Composição exata validada na prova de viabilidade 2026-10-28 (3 s,
// 1080×1920; o registo window.__timelines é exigido pelo lint).
const DEMO_HTML = `<!doctype html>
<html lang="pt-BR" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0F172A; }
      #root { width: 1080px; height: 1920px; position: relative; }
      .clip { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px;
        display: flex; align-items: center; justify-content: center;
        font-family: sans-serif; font-size: 96px; font-weight: bold; color: #E3CC85;
        text-align: center; animation: fadein 3s linear both; }
      @keyframes fadein { from { opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } to { opacity: 1; } }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="3" data-width="1080" data-height="1920">
      <div class="clip" data-start="0" data-duration="3">ATHENA<br/>primeira execução</div>
    </div>
  <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = { play: function(){}, pause: function(){}, seek: function(){}, time: function(){ return 0; } };
    </script>
  </body>
</html>
`;

function fail(message: string): never {
  console.error(`[demo] FALHA: ${message}`);
  process.exit(1);
}

async function mustExist(label: string, value: string | undefined): Promise<string> {
  if (!value?.trim()) fail(`variável em falta: ${label}`);
  try {
    await access(value!.trim(), 1);
  } catch {
    fail(`${label} inexistente ou não executável: ${value}`);
  }
  return value!.trim();
}

function ffprobeJson(mp4Path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height",
      "-show_entries",
      "format=duration,size",
      "-of",
      "json",
      mp4Path,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffprobe exit ${code}: ${err}`));
      else {
        try {
          resolve(JSON.parse(out) as Record<string, unknown>);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (process.env["HYPERFRAMES_WORKER_ENABLED"] !== "1") {
    fail("HYPERFRAMES_WORKER_ENABLED=1 é obrigatório (gate do executor).");
  }
  const cliPath = await mustExist("HYPERFRAMES_CLI", process.env["HYPERFRAMES_CLI"]);
  const browserPath = await mustExist(
    "HYPERFRAMES_BROWSER_PATH",
    process.env["HYPERFRAMES_BROWSER_PATH"],
  );

  const adapter = toolRegistry.adapterFor("hyperframes");
  if (!adapter) fail("adapter hyperframes não registrado.");
  if (!adapter!.executionReady) {
    fail("executionReady=false apesar de HYPERFRAMES_WORKER_ENABLED=1.");
  }
  console.log(`[demo] adapter hyperframes executionReady=true (gate OK)`);

  const store = new MemoryJobStore();
  const seededAt = Date.now();
  store.seed({
    id: DEMO_JOB_ID,
    orgId: DEMO_ORG,
    toolId: "hyperframes",
    params: {
      composition: { html: DEMO_HTML },
      format: "9:16",
      quality: "draft",
    },
  });
  store.seed({
    id: OTHER_JOB_ID,
    orgId: OTHER_ORG,
    toolId: "hyperframes",
    params: {
      composition: { html: DEMO_HTML },
      format: "9:16",
      quality: "draft",
    },
  });
  console.log(`[demo] jobs semeados: ${DEMO_JOB_ID} (QUEUED, ${DEMO_ORG}) + ${OTHER_JOB_ID} (${OTHER_ORG})`);

  const logLines: string[] = [];
  const worker = new Worker({
    orgId: DEMO_ORG,
    workerId: "demo-worker-1",
    concurrency: 1,
    pollIntervalMs: 500,
    attemptTimeoutMs: 300_000,
    jobTimeoutMs: 600_000,
    retry: { maxAttempts: 1 },
    store,
    logger: (record) => {
      logLines.push(JSON.stringify(record));
    },
  });

  const runPromise = worker.start();
  let finalStatus = "";
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    finalStatus = (await store.get(DEMO_JOB_ID, DEMO_ORG)).status;
    if (finalStatus === "COMPLETED" || finalStatus === "FAILED") break;
    await sleep(1000);
  }
  if (finalStatus !== "COMPLETED" && finalStatus !== "FAILED") {
    worker.stop();
    await runPromise;
    fail(`timeout: job ficou em ${finalStatus} após 240 s. Logs: ${logLines.slice(-5).join("\n")}`);
  }
  const completedAt = Date.now();
  // Dois ticks extra do loop vivo: provar que NÃO há re-execução.
  await sleep(1500);
  worker.stop();
  await runPromise;

  const snap = store.snapshot(DEMO_JOB_ID);
  const other = store.snapshot(OTHER_JOB_ID);
  const completedCount = await store.countEvents(DEMO_JOB_ID, DEMO_ORG, "execution_completed");
  console.log(`[demo] estado final: ${snap.status} (QUEUED → RUNNING → ${snap.status})`);

  if (snap.status !== "COMPLETED") {
    console.error(`[demo] eventos: ${JSON.stringify(snap.events, null, 2)}`);
    console.error(`[demo] logs: ${logLines.slice(-10).join("\n")}`);
    fail(`job terminou em ${snap.status} (erro: ${JSON.stringify(snap.error)}).`);
  }
  if (other.status !== "QUEUED") {
    fail(`isolamento por org QUEBRADO: job de outra org está em ${other.status}.`);
  }
  if (completedCount !== 1) {
    fail(`idempotência QUEBRADA: execution_completed=${completedCount} (esperado 1).`);
  }

  // Consulta — o mesmo formato que a API devolve em produção.
  const queried = await store.get(DEMO_JOB_ID, DEMO_ORG);
  if (queried.status !== "COMPLETED") fail("consulta pós-conclusão não devolve COMPLETED.");

  const result = snap.result as {
    artifactPath: string;
    artifactBytes: number;
    width: number;
    height: number;
    durationSeconds: number;
    renderSeconds: number;
  };
  const artifactInfo = await stat(result.artifactPath).catch(() => null);
  if (!artifactInfo || artifactInfo.size !== result.artifactBytes || artifactInfo.size <= 0) {
    fail(`artefacto inválido em ${result.artifactPath}.`);
  }
  const probe = await ffprobeJson(result.artifactPath);
  const streams = (probe["streams"] as Array<Record<string, unknown>>) ?? [];
  const video = streams.find((s) => s["codec_type"] === "video");
  if (!video || video["width"] !== 1080 || video["height"] !== 1920) {
    fail(`verificação ffprobe independente falhou: ${JSON.stringify(probe).slice(0, 300)}`);
  }
  const format = probe["format"] as Record<string, unknown>;
  const duration = Number.parseFloat(String(format["duration"] ?? "0"));
  if (!Number.isFinite(duration) || duration <= 0) fail("duração ffprobe inválida.");

  const summary = {
    jobId: DEMO_JOB_ID,
    orgId: DEMO_ORG,
    states: ["QUEUED", "RUNNING", "COMPLETED"],
    artifactPath: result.artifactPath,
    artifactBytes: result.artifactBytes,
    width: result.width,
    height: result.height,
    durationSeconds: result.durationSeconds,
    ffprobeDurationSeconds: duration,
    renderSeconds: result.renderSeconds,
    seedToCompletedMs: completedAt - seededAt,
    otherOrgJobId: OTHER_JOB_ID,
    otherOrgStatus: other.status,
    executionCompletedCount: completedCount,
    progressFinal: snap.progress,
    cliPath,
    browserPath,
    hyperframesVersion: "0.6.80",
    liveSupabaseTouched: false,
  };
  console.log(`[demo] RESUMO:`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[demo] OK — primeira execução real concluída com artefacto verificado.`);
}

main().catch((err: unknown) => {
  console.error(`[demo] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
