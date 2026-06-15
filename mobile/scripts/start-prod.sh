#!/usr/bin/env bash
set -euo pipefail

# start-prod.sh — Start Expo dev server with production API
# Expo's .env loading overrides shell env vars, so we swap .env temporarily.

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MOBILE_DIR"

# Backup current .env
cp .env .env.dev.bak 2>/dev/null || true

# Use production env
cp .env.production .env

echo "✓ Using .env.production → EXPO_PUBLIC_API_URL=https://canmanici.com/meetbook/api/v1"
echo ""

# Cleanup on exit
cleanup() {
  mv .env.dev.bak .env 2>/dev/null || rm -f .env
  echo "✓ Restored .env.dev.bak → .env"
}
trap cleanup EXIT

# Start Expo
exec expo start "$@"
