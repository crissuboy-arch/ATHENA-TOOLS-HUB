/**
 * Athena Tools Hub — entrypoint do WORKER de execução (processo isolado).
 *
 * Isto NÃO corre na Vercel nem no request path do frontend: é um processo
 * Node de longa duração que faz polling à fila (Supabase) e executa jobs
 * com os adapters reais. Um worker serve UMA org (isolamento por org).
 *
 * Arranque:
 *   HYPERFRAMES_WORKER_ENABLED=1 WORKER_ORG_ID=<uuid-da-org> \
 *   NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<chave> \
 *   HYPERFRAMES_CLI=<caminho p/ hyperframes/dist/cli.js> \
 *   HYPERFRAMES_BROWSER_PATH=<caminho p/ o Chrome for Testing> \
 *   HYPERFRAMES_ARTIFACTS_DIR=<dir de artefactos> \
 *   node_modules/.bin/vite-node scripts/run-worker.ts
 *
 * Variáveis opcionais: WORKER_ID, WORKER_CONCURRENCY (default 1 — render
 * é pesado; 1 Chrome de cada vez), WORKER_POLL_INTERVAL_MS (default
 * 2000), WORKER_JOB_TIMEOUT_MS (default 600000), WORKER_ATTEMPT_TIMEOUT_MS
 * (default 300000), WORKER_ALLOW_PAID_EXECUTION (default false — NUNCA
 * true para o executor HyperFrames v1, que é local e $0).
 *
 * Paragem graciosa: SIGINT/SIGTERM → stop() → aguarda os jobs ativos
 * (drain) e sai 0. Jobs interrompidos a meio ficam RUNNING e são
 * recuperados no arranque seguinte (requeue/timeout/dead-letter) — nunca
 * "concluídos" por acidente.
 *
 * Segredos: SUPABASE_SERVICE_ROLE_KEY NUNCA vai para o repo nem para
 * logs — só ambiente do processo do worker.
 */

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`[worker] ERRO: variável obrigatória em falta: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`[worker] ERRO: ${name} inválido: ${raw}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const orgId = requiredEnv("WORKER_ORG_ID");
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (process.env["HYPERFRAMES_WORKER_ENABLED"] !== "1") {
    console.error(
      "[worker] ERRO: HYPERFRAMES_WORKER_ENABLED=1 é obrigatório no ambiente do worker " +
        "(sem ele, o adapter reporta executionReady=false e nenhum job HyperFrames despacha).",
    );
    process.exit(1);
  }

  // Import dinâmico APÓS a validação de env (fail fast antes de carregar
  // a cadeia Supabase/Next).
  const { Worker, createLogger, createSupabaseJobStore } = await import("../lib/jobs/worker");

  const workerId = process.env["WORKER_ID"] ?? `worker-${Date.now().toString(36)}`;
  const worker = new Worker({
    orgId,
    workerId,
    concurrency: optionalInt("WORKER_CONCURRENCY", 1),
    pollIntervalMs: optionalInt("WORKER_POLL_INTERVAL_MS", 2000),
    jobTimeoutMs: optionalInt("WORKER_JOB_TIMEOUT_MS", 600_000),
    attemptTimeoutMs: optionalInt("WORKER_ATTEMPT_TIMEOUT_MS", 300_000),
    allowPaidExecution: process.env["WORKER_ALLOW_PAID_EXECUTION"] === "true",
    store: createSupabaseJobStore(workerId),
    logger: createLogger(workerId),
  });

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] a parar (paragem graciosa; jobs ativos terminam primeiro)…`);
    worker.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[worker] arrancado: org=${orgId} worker=${workerId}`);
  await worker.start();
  console.log(`[worker] parado.`);
}

main().catch((err: unknown) => {
  console.error(`[worker] FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
