#!/bin/bash
# ── MeetBook Offline Production Build Script ───────────────────────────────
# Requires: JDK 17, Android SDK (ANDROID_HOME set), keytool, python3
# Usage:    bash build-release.sh
# Output:   android/app/build/outputs/apk/release/app-release.apk
#
# Builds for arm64-v8a only with R8 minification
# and resource shrinking enabled.

set -euo pipefail

cd "$(dirname "$0")"

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

# Sync app.json so the app's About screen and Play Store listing match
python3 -c "
import json
p = 'app.json'
d = json.load(open(p))
d['expo']['version'] = '$VERSION'
json.dump(d, open(p, 'w'), indent=2)
"

echo "🔨 MeetBook v$VERSION — Production APK Build"
echo "   API: https://canmanici.com/meetbook/api/v1"
echo "   ABIs: arm64-v8a"
echo ""

# ── Export production API URL for entire build ──────────────────────────
# This MUST be exported as a process env var so Metro reads it during the
# JS bundle step (gradle assembleRelease runs Metro internally). The .env
# file typically contains a local dev IP and would produce a broken APK
# that can't reach the production server.
# Source from .env.production to keep the URL defined in one place.
export EXPO_PUBLIC_API_URL
EXPO_PUBLIC_API_URL=$(grep '^EXPO_PUBLIC_API_URL=' .env.production | cut -d= -f2-)
echo "   EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"

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
python3 fix-android-build.py "$VERSION" "$VERSION_CODE"

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
cd android

./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true \
  -Pandroid.enablePngCrunchInReleaseBuilds=true \
  2>&1 | tail -10

cd ..

# ── Output ────────────────────────────────────────────────────────────────
# With ABI splits enabled, the APK is named with ABI suffix
APK_DIR="android/app/build/outputs/apk/release"
APK=$(find "$APK_DIR" -name "*.apk" 2>/dev/null | head -1)

if [ -f "$APK" ]; then
    SIZE=$(du -sh "$APK" | cut -f1)
    OUT="../meetbook-v${VERSION}-release.apk"
    cp "$APK" "$OUT"
    echo ""
    echo "✅ BUILD SUCCESSFUL — $SIZE"
    echo "   $APK"
    echo "   $OUT"
    echo ""
    echo "📱 Install: adb install $OUT"
    echo "   (adb uninstall com.canmanici.meetbook first if switching debug→release)"
else
    echo "❌ BUILD FAILED"
    exit 1
fi
