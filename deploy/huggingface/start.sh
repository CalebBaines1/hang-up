#!/bin/sh
# Runs the speech service (NVIDIA Parakeet + Kokoro) next to the API in one container.
cd /app/services/speech && python -m uvicorn app:app --host 127.0.0.1 --port 8001 --log-level warning &
cd /app/apps/server && exec node --disable-warning=ExperimentalWarning dist/index.js
