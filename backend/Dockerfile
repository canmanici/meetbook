# syntax=docker/dockerfile:1
# MeetBook Backend — FastAPI on Python 3.14 via uv
#
# Performance features:
#   PYTHON_JIT=1          → CPython experimental JIT (copy-and-patch)
#   compileall             → Pre-baked .pyc bytecode at build time
#   start_app.py           → Single-process startup (no redundant imports)

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app

# Install deps first (layer caching — only rerun when lockfile changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source (__pycache__ is excluded by .dockerignore)
COPY . .

# Purge any __pycache__ that slipped through, then pre-compile for speed
RUN find /app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
 && uv run --no-dev python -m compileall -q /app -x '.venv|\.git' 2>/dev/null \
 && echo "Pre-compiled $(find /app -name '*.pyc' | wc -l) bytecode files"

# ── Runtime optimizations ────────────────────────────────────────────────────
ENV PYTHON_JIT=1
ENV PYTHONPATH=/app

# ipdb/media exist in the image so fresh named volumes inherit appuser
# ownership (a root-owned volume would make the IP-database download fail).
RUN useradd -m -u 1000 appuser && mkdir -p /app/ipdb /app/media && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uv", "run", "--no-dev", "python", "scripts/start_app.py"]
