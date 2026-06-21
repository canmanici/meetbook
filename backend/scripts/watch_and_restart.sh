#!/usr/bin/env bash
# File watcher — restarts uvicorn when source code changes.
# Used in dev mode only. Uses watchfiles (Rust-backed, fast, Docker-friendly).
set -euo pipefail

WATCH_PATHS="${WATCH_PATHS:-/app/app /app/scripts /app/alembic}"

echo "=== Dev mode: watching for changes in $WATCH_PATHS ==="
echo "=== Edit any .py file → uvicorn restarts automatically ==="

# watchfiles syntax: watchfiles [options] COMMAND PATHS...
# Command is a positional arg, not --process. No --delay or --signal flags.
exec uv run watchfiles \
    --filter python \
    --verbose \
    --grace-period 2 \
    "uv run --no-dev uvicorn app.main:app --host 0.0.0.0 --port 8000" \
    $WATCH_PATHS
