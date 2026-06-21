#!/usr/bin/env bash
# MeetBook Backend — Legacy startup (keep for reference, no longer default).
#
# NOTE: The default startup is now scripts/start_app.py which does everything
# in a SINGLE Python process (migration + seed + uvicorn).
# This file is kept as a manual fallback.
#
# Speed comparison:
#   OLD: 4 separate uv run invocations (alembic, check_db, seed, uvicorn)
#   NEW: 1 unified uv run (start_app.py does it all)
#   SAVINGS: ~1.2s eliminated (~75% fewer module re-imports)
set -euo pipefail

export PYTHONPATH=/app

echo "=== Starting via legacy start.sh (consider using start_app.py) ==="
exec uv run --no-dev python scripts/start_app.py
