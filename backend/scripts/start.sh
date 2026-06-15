#!/usr/bin/env bash
set -euo pipefail

export PYTHONPATH=/app

# Run pending Alembic migrations before accepting traffic.
# This handles fresh databases (docker compose down -v) and schema updates.
echo "=== Running Alembic migrations... ==="
uv run --no-dev alembic upgrade head

# Safety check: alembic_version can be at head while actual tables are missing
# (corrupted state after volume wipe or partial restore). Verify users table exists.
if ! uv run --no-dev python scripts/check_db.py; then
    echo "=== WARNING: alembic_version at head but users table missing. Forcing full re-migration... ==="
    uv run --no-dev alembic stamp base
    uv run --no-dev alembic upgrade head
    echo "=== Full re-migration complete. ==="
fi

echo "=== Migrations complete. ==="

# Start the FastAPI app
exec uv run --no-dev uvicorn app.main:app --host 0.0.0.0 --port 8000
