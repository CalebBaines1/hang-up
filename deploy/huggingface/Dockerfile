# Hang Up as a single-container Hugging Face Space (free CPU tier: 2 vCPU, 16 GB).
# Copy this file into the Space as "Dockerfile". It downloads the code from
# GitHub, so the Space needs no other files. Add NEBIUS_API_KEY as a Space secret.
# To deploy new code: Space settings -> "Factory rebuild".

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ARG REPO=https://github.com/CalebBaines1/hang-up.git
ARG BRANCH=main
RUN git clone --depth 1 --branch "$BRANCH" "$REPO" /app
WORKDIR /app
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @hangup/server build \
 && pnpm --filter @hangup/web build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 ca-certificates libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app
RUN pip install --no-cache-dir -r /app/services/speech/requirements.txt \
 && /app/services/speech/download_models.sh /models
ENV PORT=7860 \
    HOST=0.0.0.0 \
    WEB_DIR=/app/apps/web/dist \
    DB_PATH=/tmp/hangup/hangup.db \
    SPEECH_URL=http://127.0.0.1:8001 \
    MODELS_DIR=/models \
    NUM_THREADS=2 \
    CORS_ORIGIN=* \
    NODE_ENV=production
EXPOSE 7860
CMD ["sh", "/app/deploy/huggingface/start.sh"]
