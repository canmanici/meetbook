#!/bin/bash
# ── MeetBook Offline Production Build Script ───────────────────────────────
# Requires: JDK 17, Android SDK (ANDROID_HOME set), keytool
# Usage:    bash build-release.sh
# Output:   android/app/build/outputs/apk/release/app-release.apk

set -e

cd "$(dirname "$0")"

echo "🔨 MeetBook v1.0.0 — Production APK Build"
echo "   API: https://canmanici.com/meetbook/api/v1"
echo ""

# ── Prebuild (regenerate android/ios if needed) ───────────────────────────
echo "📦 Running prebuild..."
EXPO_PUBLIC_API_URL="https://canmanici.com/meetbook/api/v1" npx expo prebuild --platform android --no-install 2>&1 | tail -3

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

BUILD_GRADLE="android/app/build.gradle"
if grep -q "signingConfig signingConfigs.debug" "$BUILD_GRADLE"; then
    echo "✏️  Patching build.gradle for release signing..."
    sed -i 's/signingConfig signingConfigs.debug/\/\/ signingConfig signingConfigs.debug/' "$BUILD_GRADLE"
    sed -i '/\/\/ signingConfig signingConfigs.debug/a\            signingConfig signingConfigs.release' "$BUILD_GRADLE"
    
    # Add release signing config if not present
    if ! grep -q "signingConfigs {.*release" "$BUILD_GRADLE"; then
        sed -i '/signingConfigs {/,/}/{
            /}/i\
        release {\
            storeFile file(findProperty('"'"'RELEASE_STORE_FILE'"'"') ?: '"'"'release.keystore'"'"')\
            storePassword findProperty('"'"'RELEASE_STORE_PASSWORD'"'"') ?: '"'"'meetbook'"'"'\
            keyAlias findProperty('"'"'RELEASE_KEY_ALIAS'"'"') ?: '"'"'meetbook-release'"'"'\
            keyPassword findProperty('"'"'RELEASE_KEY_PASSWORD'"'"') ?: '"'"'meetbook'"'"'\
        }
        }' "$BUILD_GRADLE"
    fi
fi

# ── Build ─────────────────────────────────────────────────────────────────
echo "🏗️  Building release APK..."
cd android
./gradlew assembleRelease 2>&1 | tail -5
cd ..

# ── Output ────────────────────────────────────────────────────────────────
APK="android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK" ]; then
    SIZE=$(du -sh "$APK" | cut -f1)
    echo ""
    echo "✅ BUILD SUCCESSFUL — $SIZE"
    echo "   $APK"
    echo ""
    echo "📱 Install: adb install $APK"
    echo "   (adb uninstall com.canmanici.meetbook first if switching debug→release)"
    cp "$APK" ../meetbook-v1.0.0-release.apk 2>/dev/null
else
    echo "❌ BUILD FAILED"
    exit 1
fi
