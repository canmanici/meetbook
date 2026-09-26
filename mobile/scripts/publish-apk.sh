#!/bin/bash
# ── Publish an APK as an in-app update ─────────────────────────────────────────
# Uploads the APK to the MeetBook backend (stored in MinIO). Every installed app
# checks /app/android/latest on launch and offers the update.
#
# Usage:
#   bash scripts/publish-apk.sh <file.apk> [--api URL] [--notes "Yenilikler..."] [--mandatory]
#
#   --api        backend base (default: production https://canmanici.com/meetbook/api/v1)
#   --notes      release notes shown in the update dialog (Turkish)
#   --mandatory  users below this version can't dismiss the update
#
# Admin login: MEETBOOK_ADMIN_EMAIL / MEETBOOK_ADMIN_PASSWORD env vars, or you
# are prompted (password is not echoed and never stored).
# versionCode / versionName are read from the APK itself (aapt2), so the server
# can never advertise a different number than what actually gets installed.
# ==============================================================================
set -euo pipefail
# Resolve the APK argument against the CALLER's directory before we cd —
# otherwise a relative path (the usual case) is looked up inside mobile/.
ORIG_PWD=$(pwd)
cd "$(dirname "$0")/.."

APK=""; API="https://canmanici.com/meetbook/api/v1"; NOTES=""; MANDATORY="false"
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --notes) NOTES="$2"; shift 2 ;;
    --mandatory) MANDATORY="true"; shift ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
    *) APK="$1"; shift ;;
  esac
done
case "$APK" in /*|"") ;; *) APK="$ORIG_PWD/$APK" ;; esac
[ -f "$APK" ] || { echo "❌ APK not found: '$APK'"; exit 1; }

# ── Read version from the APK ─────────────────────────────────────────────────
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
AAPT=$(ls "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)
[ -n "$AAPT" ] || { echo "❌ aapt2 not found (set ANDROID_HOME)"; exit 1; }
BADGE=$("$AAPT" dump badging "$APK" 2>/dev/null | grep -m1 '^package:' || true)
PKG=$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$BADGE")
CODE=$(sed -n "s/.* versionCode='\([0-9]*\)'.*/\1/p" <<<"$BADGE")
NAME=$(sed -n "s/.* versionName='\([^']*\)'.*/\1/p" <<<"$BADGE")
[ "$PKG" = "com.canmanici.meetbook" ] || { echo "❌ Wrong package: $PKG"; exit 1; }

# The APK must point at the same server it is published to.
BUNDLE=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | tr -d '\000' || true)
if ! grep -qaF "$API" <<<"$BUNDLE"; then
  echo "❌ This APK is not built for $API — it would install an app that talks to another server."
  exit 1
fi

echo "📦 $NAME (versionCode $CODE) — $(du -h "$APK" | cut -f1)"
echo "   Server:    $API"
echo "   Mandatory: $MANDATORY"
[ -n "$NOTES" ] && echo "   Notes:     $NOTES"

# ── Admin login ───────────────────────────────────────────────────────────────
EMAIL="${MEETBOOK_ADMIN_EMAIL:-}"
PASS="${MEETBOOK_ADMIN_PASSWORD:-}"
[ -n "$EMAIL" ] || read -rp "Admin e-posta: " EMAIL
[ -n "$PASS" ] || { read -rsp "Admin şifre: " PASS; echo; }
LOGIN_JSON=$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))' "$EMAIL" "$PASS")
TOKEN=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_JSON" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' 2>/dev/null) \
  || { echo "❌ Login failed — e-posta veya şifre hatalı (ya da sunucuya ulaşılamadı)"; exit 1; }
unset PASS LOGIN_JSON

# ── Upload ────────────────────────────────────────────────────────────────────
echo "⬆️  Uploading..."
RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/admin/app-releases" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$APK;type=application/vnd.android.package-archive" \
  -F "version_code=$CODE" -F "version_name=$NAME" \
  -F "mandatory=$MANDATORY" -F "changelog=$NOTES")
STATUS=$(tail -1 <<<"$RESP"); BODY=$(sed '$d' <<<"$RESP")
if [ "$STATUS" = "403" ]; then
  echo "❌ Bu hesap admin değil (HTTP 403). Dokploy'da ADMIN_EMAILS=$EMAIL ekleyip redeploy et."
  exit 1
fi
if [ "$STATUS" != "201" ]; then
  echo "❌ Upload failed (HTTP $STATUS): $BODY"
  exit 1
fi
echo "✅ Published $NAME ($CODE). Apps will offer it on next launch."
echo "   Check: curl '$API/app/android/latest?version_code=$((CODE - 1))'"
