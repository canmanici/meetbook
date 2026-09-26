#!/bin/bash
# ── MeetBook Offline Production Build Script ───────────────────────────────
# Requires: JDK 17, Android SDK (ANDROID_HOME set), keytool, python3
# Usage:    bash build-release.sh [--publish] [--notes "Yenilikler…"] [--mandatory]
#           bash build-release.sh --rollback 1.1.56 [--notes "…"]
#             EMERGENCY: rebuild the code of tag v1.1.56 under a NEW, higher
#             versionCode and publish it as a MANDATORY update (Android can't
#             downgrade, so rollback = roll forward to the old code).
# Output:   android/app/build/outputs/apk/release/app-release.apk
#
# Builds for arm64-v8a only with R8 minification
# and resource shrinking enabled.

set -euo pipefail

cd "$(dirname "$0")"
source scripts/env-defaults.sh

# ── Options ─────────────────────────────────────────────────────────────────
#   --publish          upload the APK as an in-app update after building
#   --notes "…"        release notes shown in the update dialog
#   --mandatory        users on older versions must update
PUBLISH=0; NOTES=""; MANDATORY_FLAG=""; ROLLBACK_TO=""; API_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH=1; shift ;;
    --rollback) ROLLBACK_TO="${2#v}"; shift 2 ;;
    --api) API_OVERRIDE="$2"; shift 2 ;;   # test against a staging/local backend
    --notes) NOTES="$2"; shift 2 ;;
    --mandatory) MANDATORY_FLAG="--mandatory"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

MAIN_DIR=$(pwd)
REPO_ROOT=$(git rev-parse --show-toplevel)
# Is the committed code what we're about to build? (checked BEFORE the
# version bump below touches app.json) — only then can we tag the release.
TREE_CLEAN=0
[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no -- mobile backend admin)" ] && TREE_CLEAN=1

if [ -n "$ROLLBACK_TO" ]; then
  git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/v$ROLLBACK_TO" >/dev/null || {
    echo "❌ No git tag v$ROLLBACK_TO — only tagged releases can be rolled back to."
    echo "   Tags: $(git -C "$REPO_ROOT" tag -l 'v*' | sort -V | tail -8 | tr '\n' ' ')"
    exit 1
  }
fi

# ── Versioning ────────────────────────────────────────────────────────────
# VERSION is derived from VERSION_CODE so they stay in sync.
# versionCode is a monotonically-increasing build counter (Android requires
# it to strictly increase between releases), persisted in .version-code and
# bumped once per invocation of this script.
# The version format is: MAJOR.MINOR.VERSION_CODE
VERSION_CODE_FILE=".version-code"
VERSION_CODE=$(($(cat "$VERSION_CODE_FILE" 2>/dev/null || echo 0) + 1))
echo "$VERSION_CODE" > "$VERSION_CODE_FILE"

MAJOR=1
MINOR=1
VERSION="${MAJOR}.${MINOR}.${VERSION_CODE}"
OUT="$REPO_ROOT/meetbook-v${VERSION}-release.apk"

# ── Emergency rollback: build the OLD code in a throwaway worktree ─────────
if [ -n "$ROLLBACK_TO" ]; then
  WT="$(mktemp -d)/meetbook-rollback"
  echo "⏪ ROLLBACK: code of v$ROLLBACK_TO → new release v$VERSION (mandatory)"
  git -C "$REPO_ROOT" worktree add --detach "$WT" "v$ROLLBACK_TO" >/dev/null
  trap 'cd "$MAIN_DIR"; git -C "$REPO_ROOT" worktree remove --force "$WT" 2>/dev/null || true' EXIT
  # Reuse the installed deps and the native project (both gitignored).
  ln -s "$MAIN_DIR/node_modules" "$WT/mobile/node_modules"
  rsync -a --exclude 'build/' --exclude '.gradle/' --exclude '.cxx/' "$MAIN_DIR/android/" "$WT/mobile/android/"
  cp "$MAIN_DIR/.env.production" "$WT/mobile/.env.production"
  cd "$WT/mobile"
  PUBLISH=1
  MANDATORY_FLAG="--mandatory"
  NOTES="${NOTES:-Acil düzeltme: son sürümdeki bir sorun nedeniyle önceki kararlı sürüme ($ROLLBACK_TO) dönüldü.}"
fi

# Sync app.json so the app's About screen and Play Store listing match
python3 -c "
import json
p = 'app.json'
d = json.load(open(p))
d['expo']['version'] = '$VERSION'
json.dump(d, open(p, 'w'), indent=2)
"

echo "🔨 MeetBook v$VERSION — Production APK Build"
echo "   API: ${API_OVERRIDE:-https://canmanici.com/meetbook/api/v1}"
echo "   ABIs: arm64-v8a"
echo ""

# ── Export production API URL for entire build ──────────────────────────
# This MUST be exported as a process env var so Metro reads it during the
# JS bundle step (gradle assembleRelease runs Metro internally). The .env
# file typically contains a local dev IP and would produce a broken APK
# that can't reach the production server.
# Source from .env.production to keep the URL defined in one place.
export EXPO_PUBLIC_API_URL EXPO_PUBLIC_MAPTILER_KEY EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
EXPO_PUBLIC_API_URL=$(grep '^EXPO_PUBLIC_API_URL=' .env.production | cut -d= -f2-)
EXPO_PUBLIC_API_URL=${API_OVERRIDE:-$EXPO_PUBLIC_API_URL}
EXPO_PUBLIC_MAPTILER_KEY=$(grep '^EXPO_PUBLIC_MAPTILER_KEY=' .env.production | cut -d= -f2- || true)
EXPO_PUBLIC_MAPTILER_KEY=${EXPO_PUBLIC_MAPTILER_KEY:-$MAPTILER_KEY}
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=$(grep '^EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=' .env.production | cut -d= -f2- || true)
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:-$GOOGLE_WEB_CLIENT_ID}
echo "   EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"
echo "   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:-(none — Google button hidden)}"

# ── Preflight: is the PRODUCTION backend ready for Google login? ─────────
# A fake token should be rejected as INVALID_GOOGLE_TOKEN. GOOGLE_NOT_CONFIGURED
# means GOOGLE_CLIENT_IDS isn't set in Dokploy; 404 means the backend with
# /auth/google hasn't been deployed yet. Either way the button would fail.
if [ -n "$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID" ]; then
  GRESP=$(curl -s -m 10 -w ' HTTP%{http_code}' -X POST "$EXPO_PUBLIC_API_URL/auth/google" \
    -H 'Content-Type: application/json' -d '{"id_token":"preflight-not-a-real-token-xxxxxxxx"}' || echo "unreachable")
  case "$GRESP" in
    *INVALID_GOOGLE_TOKEN*) echo "   ✅ Production backend: Google login configured" ;;
    *GOOGLE_NOT_CONFIGURED*) echo "   ⚠️  Production backend: set GOOGLE_CLIENT_IDS=$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in Dokploy and redeploy" ;;
    *HTTP404*) echo "   ⚠️  Production backend has no /auth/google yet — deploy the backend first" ;;
    *) echo "   ⚠️  Production backend check inconclusive: $GRESP" ;;
  esac
fi

# ── Prebuild (regenerate android/ios if needed) ───────────────────────────
# Only run if android/ doesn't exist yet (saves ~5s on subsequent builds)
if [ ! -d "android/app" ]; then
    echo "📦 Running prebuild..."
    npx expo prebuild --platform android --no-install 2>&1 | tail -3
else
    echo "📦 Android project exists, skipping prebuild"
fi

# ── Fix build.gradle (expo prebuild generates a broken signingConfigs block) ─
# Also syncs versionName/versionCode every run, since prebuild only writes them
# once and android/ is normally reused across builds.
python3 "$MAIN_DIR/fix-android-build.py" "$VERSION" "$VERSION_CODE"

# ── Keystore ──────────────────────────────────────────────────────────────
KEYSTORE="android/app/release.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "🔑 Generating release keystore..."
    keytool -genkeypair -v -storetype PKCS12 \
      -keystore "$KEYSTORE" \
      -alias meetbook-release \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass meetbook -keypass meetbook \
      -dname "CN=MeetBook, OU=Mobile, O=MeetBook, L=Istanbul, ST=Istanbul, C=TR" 2>&1 | tail -1
fi

# ── Signing config (inject after prebuild) ─────────────────────────────────
GRADLE_PROPS="android/gradle.properties"
if ! grep -q "RELEASE_STORE_FILE" "$GRADLE_PROPS" 2>/dev/null; then
    echo "✏️  Injecting release signing config..."
    cat >> "$GRADLE_PROPS" << 'EOF'

# Release signing
RELEASE_STORE_FILE=release.keystore
RELEASE_KEY_ALIAS=meetbook-release
RELEASE_STORE_PASSWORD=meetbook
RELEASE_KEY_PASSWORD=meetbook
EOF
fi

# ── Build ─────────────────────────────────────────────────────────────────
echo "🏗️  Building release APK (arm64-v8a only)..."
clear_metro_cache
rm -f android/app/build/outputs/apk/release/*.apk
cd android

# --no-daemon: a reused Gradle daemon keeps OLD env vars (e.g. a LAN API URL).
./gradlew assembleRelease --no-daemon \
  -PreactNativeArchitectures=arm64-v8a \
  -PmeetbookAbis=arm64-v8a \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true \
  -Pandroid.enablePngCrunchInReleaseBuilds=true \
  2>&1 | tail -10

cd ..

# ── Output ────────────────────────────────────────────────────────────────
# With ABI splits enabled, the APK is named with ABI suffix
APK_DIR="android/app/build/outputs/apk/release"
APK="$APK_DIR/app-arm64-v8a-release.apk"

if [ -f "$APK" ]; then
    # The bundle must point at production and carry the Google client ID.
    BUNDLE=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | tr -d '\000' || true)
    if ! grep -qaF "$EXPO_PUBLIC_API_URL" <<<"$BUNDLE"; then
        echo "❌ Production API URL missing from the JS bundle — refusing to ship"; exit 1
    fi
    if [ -z "$API_OVERRIDE" ] && grep -qaE 'http://(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|localhost)[^"]*/api/v1' <<<"$BUNDLE"; then
        echo "❌ A local/LAN API URL is baked into the bundle — refusing to ship"; exit 1
    fi
    if [ -n "$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID" ] && ! grep -qaF "$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID" <<<"$BUNDLE"; then
        echo "❌ Google client ID missing from the JS bundle — refusing to ship"; exit 1
    fi
    SHA1=$(apk_sha1 "$APK")
    SIZE=$(du -sh "$APK" | cut -f1)
    cp "$APK" "$OUT"
    # Tag the exact code of this release so it can be rolled back to later.
    if [ -n "$ROLLBACK_TO" ]; then
        git -C "$REPO_ROOT" tag -a "v$VERSION" "v$ROLLBACK_TO^{commit}" -m "v$VERSION = rollback to v$ROLLBACK_TO" 2>/dev/null \
          && echo "🏷️  Tagged v$VERSION (same code as v$ROLLBACK_TO)"
    elif [ "$TREE_CLEAN" = "1" ]; then
        git -C "$REPO_ROOT" tag -a "v$VERSION" -m "MeetBook v$VERSION" 2>/dev/null && echo "🏷️  Tagged v$VERSION"
    else
        echo "⚠️  Uncommitted changes — v$VERSION NOT tagged, so it can't be a rollback target later."
        echo "   Commit first next time: git commit -am … && bash build-release.sh"
    fi
    echo ""
    echo "✅ BUILD SUCCESSFUL — $SIZE"
    echo "   $APK"
    echo "   $OUT"
    echo ""
    echo "🔑 Signed with SHA-1: $SHA1"
    echo "   → Google Cloud → Credentials → an Android OAuth client with package"
    echo "     com.canmanici.meetbook and THIS SHA-1 must exist, or Google login fails."
    echo ""
    echo "🖥️  Production backend (Dokploy env) needs:"
    echo "     GOOGLE_CLIENT_IDS=$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"
    echo ""
    if [ "$PUBLISH" = "1" ]; then
        echo "🚀 Publishing as in-app update → $EXPO_PUBLIC_API_URL"
        bash "$MAIN_DIR/scripts/publish-apk.sh" "$OUT" --api "$EXPO_PUBLIC_API_URL" --notes "$NOTES" $MANDATORY_FLAG
    else
        echo "🚀 To ship it as an in-app update:"
        echo "   bash scripts/publish-apk.sh $OUT --api $EXPO_PUBLIC_API_URL --notes \"Yenilikler…\""
    fi
    if [ -n "$ROLLBACK_TO" ]; then
        echo ""
        echo "⏪ Rollback published. Next: withdraw the broken release in the admin panel"
        echo "   (Uygulama Sürümleri → 🚨 Acil geri çek) if you haven't already."
    fi
    echo ""
    echo "📱 Install: adb install $OUT"
    echo "   (adb uninstall com.canmanici.meetbook first if switching debug→release)"
else
    echo "❌ BUILD FAILED"
    exit 1
fi
