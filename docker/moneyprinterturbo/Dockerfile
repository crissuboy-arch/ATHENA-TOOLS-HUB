# MoneyPrinterTurbo — isolated engine image (NOT a production deployment).
#
# Verified 2026-10-27 against the official pip package mpt==1.3.9 (MIT):
# the package installs the `app` module and `app.asgi:app` imports cleanly,
# so the API server runs with uvicorn (the pip console script only exposes
# `cli` and `webui`; there is no `mpt api` subcommand).
#
# Build on a host with Docker (authorized separately):
#   docker build -t moneyprinterturbo-ATHENA-isolated .
# Run with docker-compose.yml in this directory. The image contains NO
# credentials: config.toml (with api_key) is mounted at runtime, gitignored.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPT_HOME=/data \
    PATH="/usr/local/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "mpt==1.3.9"

WORKDIR /app
EXPOSE 8080

# Loopback only: the compose file publishes 127.0.0.1:8080. Never expose
# this API publicly without TLS, network controls and a configured api_key.
CMD ["uvicorn", "app.asgi:app", "--host", "127.0.0.1", "--port", "8080"]
