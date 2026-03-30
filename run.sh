#!/usr/bin/with-contenv bashio

bashio::log.info "Starting Travel Assistant..."

cd /app
exec python3 -m uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8099 \
    --log-level info
