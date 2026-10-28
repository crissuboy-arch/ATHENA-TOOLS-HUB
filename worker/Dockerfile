# Worker de execução do ATHENA Tools Hub — processo isolado (HyperFrames).
#
# Isto NÃO é o servidor web: corre scripts/run-worker.ts em polling à fila
# Supabase e executa jobs com o adapter real. Um contentor = UMA org.
#
# Build (a partir da raiz do repo):
#   docker build -f worker/Dockerfile -t athena-tools-hub-worker .
# Run (segredos SÓ via ambiente do contentor, nunca na imagem):
#   docker run -d --restart always --name athena-worker \
#     -e WORKER_ORG_ID=<uuid-da-org> \
#     -e NEXT_PUBLIC_SUPABASE_URL=<url> \
#     -e SUPABASE_SERVICE_ROLE_KEY=<chave> \
#     -e HYPERFRAMES_WORKER_ENABLED=1 \
#     -e HYPERFRAMES_CLI=/usr/local/lib/node_modules/hyperframes/dist/cli.js \
#     -e HYPERFRAMES_BROWSER_PATH=/opt/chrome-for-testing/chrome \
#     -e HYPERFRAMES_ARTIFACTS_DIR=/data/hyperframes-artifacts \
#     -v athena-artifacts:/data \
#     athena-tools-hub-worker
#
# Notas de construção (ler antes de mexer):
# - vite-node vem das devDeps (vitest): o build USA --include=dev.
# - hyperframes@0.6.80 global, com --ignore-scripts (o postinstall do
#   onnxruntime-node falha atrás de proxies com TLS intercetado).
# - Chrome for Testing PINADO na build provada (156.0.8078.4). NUNCA
#   chromium 152: bloqueia a navegação loopback do CLI
#   (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, sem flag que resolva).
#   Se a build exata deixar de estar disponível, subir para a CfT estável
#   mais recente E revalidar com scripts/demo-first-execution.ts antes de
#   pôr jobs reais — o executor falha jobs com erro real nesse caso,
#   nunca finge sucesso.
FROM node:24-bookworm-slim

# ffmpeg + ffprobe + libs do Chrome headless (sem --no-install-recommends
# a mais: só o necessário para headless + ffmpeg).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .

# HyperFrames global pinado (sem postinstall) + Chrome for Testing.
RUN npm install -g hyperframes@0.6.80 --ignore-scripts --no-audit --no-fund \
  && npx --yes @puppeteer/browsers install chrome@156.0.8078.4 \
  && mkdir -p /opt/chrome-for-testing \
  && cp "$(ls /root/.cache/puppeteer/chrome/linux-*/chrome-linux/chrome | head -1)" /opt/chrome-for-testing/chrome \
  && /opt/chrome-for-testing/chrome --version

# Defaults do worker (o operador SOBRESCREVE no run; segredos nunca aqui).
ENV HYPERFRAMES_WORKER_ENABLED=1 \
    HYPERFRAMES_CLI=/usr/local/lib/node_modules/hyperframes/dist/cli.js \
    HYPERFRAMES_BROWSER_PATH=/opt/chrome-for-testing/chrome \
    HYPERFRAMES_ARTIFACTS_DIR=/data/hyperframes-artifacts \
    WORKER_CONCURRENCY=1 \
    NODE_ENV=production

VOLUME /data

CMD ["node_modules/.bin/vite-node", "scripts/run-worker.ts"]
