# Shared dev env defaults — sourced by build-local.sh and detect-api-url.sh
# so the two scripts can't drift out of sync (e.g. one writing .env without
# the other's keys and silently wiping them on the next run).
MAPTILER_KEY="eKJft93A5dolP425TPfm"

# Sign in with Google — the WEB OAuth client ID (Google Cloud → Credentials).
# Not a secret: it ends up inside every APK anyway. The backend must accept the
# same value via GOOGLE_CLIENT_IDS. Empty = the Google button is hidden.
GOOGLE_WEB_CLIENT_ID="500347984793-74ed4mctraaf6gqg28307shngbt1krr1.apps.googleusercontent.com"

# Metro inlines EXPO_PUBLIC_* at transform time and caches the result, so a
# changed URL / client ID can silently keep the OLD value in a new APK.
clear_metro_cache() {
  rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* node_modules/.cache/metro 2>/dev/null || true
  rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets 2>/dev/null || true
}

# Print the SHA-1 an APK is signed with (Google's Android OAuth client needs it).
apk_sha1() {
  local apksigner
  apksigner=$(ls "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
  [ -n "$apksigner" ] || { echo "(apksigner not found)"; return; }
  "$apksigner" verify --print-certs "$1" 2>/dev/null | grep -m1 'SHA-1' | awk '{print toupper($NF)}' | sed 's/../&:/g;s/:$//'
}
