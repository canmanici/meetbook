# syntax=docker/dockerfile:1
# MeetBook Backend — FastAPI on Python 3.14 via uv
#
# Performance features:
#   PYTHON_JIT=1          → CPython experimental JIT (copy-and-patch)
#   compileall             → Pre-baked .pyc bytecode at build time
#   start_app.py           → Single-process startup (no redundant imports)

# Admin panel (static HTML, lives outside this build context). Empty by
# default; docker-compose.prod.yml overrides this stage with the repo's
# ./admin via `additional_contexts`, so the panel ships inside the image and
# never depends on a host bind mount surviving between deploys.
FROM scratch AS admin

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app

# Install deps first (layer caching — only rerun when lockfile changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source (__pycache__ is excluded by .dockerignore)
COPY . .
COPY --from=admin / /app/admin/

# Purge any __pycache__ that slipped through, then pre-compile for speed
RUN find /app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
 && uv run --no-dev python -m compileall -q /app -x '.venv|\.git' 2>/dev/null \
 && echo "Pre-compiled $(find /app -name '*.pyc' | wc -l) bytecode files"

# ── Runtime optimizations ────────────────────────────────────────────────────
ENV PYTHON_JIT=1
ENV PYTHONPATH=/app
# glibc gives each thread its own malloc arena (up to 8 x cores); an async
# single-process server gains nothing from that but fragmented RSS.
ENV MALLOC_ARENA_MAX=2
# Run the venv's interpreter directly: `uv run` stayed resident as PID 1
# (~49 MB RSS) only to wrap the Python process. start_app.py runs
# migrations/seed in-process and never shells out to uv.
ENV VIRTUAL_ENV=/app/.venv
ENV PATH=/app/.venv/bin:$PATH

# ipdb/media exist in the image so fresh named volumes inherit appuser
# ownership (a root-owned volume would make the IP-database download fail).
RUN useradd -m -u 1000 appuser && mkdir -p /app/ipdb /app/media && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["/app/.venv/bin/python", "scripts/start_app.py"]
