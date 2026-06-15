# syntax=docker/dockerfile:1
# MeetBook Backend — FastAPI on Python 3.14 via uv

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app

# Install deps first (layer caching — only rerun when lockfile changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source
COPY . .

EXPOSE 8000

CMD ["./scripts/start.sh"]
