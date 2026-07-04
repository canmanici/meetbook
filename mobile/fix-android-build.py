#!/usr/bin/env python3
"""
Fix android/app/build.gradle after `expo prebuild`:
  1. Fix the malformed signingConfigs block (nested release inside debug)
  2. Add ndk abiFilters for arm64-v8a only
  3. Fix duplicate signingConfig lines in debug buildType
  4. Enable R8 minification and resource shrinking for release
  5. Sync versionName/versionCode from app.json + .version-code (build-release.sh passes them)
"""
import re, os, sys

BUILD_GRADLE = "android/app/build.gradle"

with open(BUILD_GRADLE, "r") as f:
    content = f.read()

changes = []

# ── 0. Sync versionName/versionCode (args: versionName versionCode) ────────
# expo prebuild only writes these on first generation, so without this the
# gradle file silently drifts from app.json on every later build.
if len(sys.argv) >= 3:
    version_name, version_code = sys.argv[1], sys.argv[2]
    new_content = re.sub(r'versionCode\s+\d+', f'versionCode {version_code}', content)
    new_content = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version_name}"', new_content)
    if new_content != content:
        content = new_content
        changes.append(f"Synced versionName={version_name} versionCode={version_code}")

# ── 1. Fix signingConfigs: remove nested release inside debug ──────────────
# The bug: expo generates:
#   signingConfigs {
#       debug {
#           ...storeFile...
#           release {   <-- NESTED inside debug
#               ...
#           }
#       }               <-- closes debug
#       release {       <-- sibling (correct but duplicated)
#           ...
#       }
#   }
# Fix: remove the nested release block and its closing brace inside debug

# Pattern: the debug block followed by inline release block
old_signing = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        release {
            storeFile file(findProperty('RELEASE_STORE_FILE') ?: 'release.keystore')
            storePassword findProperty('RELEASE_STORE_PASSWORD') ?: 'meetbook'
            keyAlias findProperty('RELEASE_KEY_ALIAS') ?: 'meetbook-release'
            keyPassword findProperty('RELEASE_KEY_PASSWORD') ?: 'meetbook'
        }
        }
        release {
            storeFile file(findProperty('RELEASE_STORE_FILE') ?: 'release.keystore')
            storePassword findProperty('RELEASE_STORE_PASSWORD') ?: 'meetbook'
            keyAlias findProperty('RELEASE_KEY_ALIAS') ?: 'meetbook-release'
            keyPassword findProperty('RELEASE_KEY_PASSWORD') ?: 'meetbook'
        }
    }"""

new_signing = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(findProperty('RELEASE_STORE_FILE') ?: 'release.keystore')
            storePassword findProperty('RELEASE_STORE_PASSWORD') ?: 'meetbook'
            keyAlias findProperty('RELEASE_KEY_ALIAS') ?: 'meetbook-release'
            keyPassword findProperty('RELEASE_KEY_PASSWORD') ?: 'meetbook'
        }
    }"""

if old_signing in content:
    content = content.replace(old_signing, new_signing)
    changes.append("Fixed malformed signingConfigs block")
else:
    changes.append("signingConfigs block: pattern not matched (checking for alternative)")

# ── 2. Remove ndk abiFilters from defaultConfig (splits handles ABI filtering) ─
# The splits { abi } block does the actual filtering; ndk abiFilters conflicts with it
content = re.sub(
    r'\s+// Only build for arm64.*?\n\s+ndk \{[^}]*\}',
    '',
    content,
    flags=re.DOTALL
)
content = re.sub(
    r'\s+ndk \{[^}]*abiFilters[^}]*\}',
    '',
    content
)
changes.append("Removed ndk abiFilters (splits handles ABI filtering)")

# ── 3. Fix duplicate signingConfig lines in debug buildType ─────────────────
content = re.sub(
    r'(\s+)(debug\s*\{[^}]*?signingConfig\s+signingConfigs\.release\s*\n\s*)signingConfig\s+signingConfigs\.release',
    r'\1\2',
    content
)
changes.append("Fixed duplicate signingConfig line in debug buildType")

# ── 4. Enable minify and shrinkResources in release buildType ───────────────
# Change from 'false' to 'true' for the findProperty defaults
content = content.replace(
    "def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
    "def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'true'"
)
changes.append("Enabled resource shrinking in release build (default: true)")

with open(BUILD_GRADLE, "r") as f:
    current = f.read()

if "minifyEnabled enableMinifyInReleaseBuilds" in current:
    # The enableMinifyInReleaseBuilds variable reads from property with default 'false'
    # Change default to 'true'
    content = content.replace(
        "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()",
        "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: true).toBoolean()"
    )
    changes.append("Enabled R8 minification in release build (default: true)")

# ── 4b. Fix hermesCommand for RN 0.81+ — hermes-compiler is no longer a
# standalone npm package; it lives inside react-native/sdks/hermesc.
old_hermes = "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })"
new_hermes = "require.resolve('react-native/package.json')"
if old_hermes in content:
    content = content.replace(
        old_hermes,
        new_hermes
    )
    # Also fix the path suffix: "hermesc/%OS-BIN%/hermesc" → "sdks/hermesc/%OS-BIN%/hermesc"
    content = content.replace(
        'getAbsolutePath() + "/hermesc/%OS-BIN%/hermesc"',
        'getAbsolutePath() + "/sdks/hermesc/%OS-BIN%/hermesc"'
    )
    changes.append("Fixed hermesCommand path for RN 0.81+ (hermes-compiler → react-native/sdks)")

# ── 5. Ensure expo.useLegacyPackaging=true in gradle.properties ─────────
GRADLE_PROPS = "android/gradle.properties"
with open(GRADLE_PROPS, "r") as f:
    props = f.read()
if "expo.useLegacyPackaging=false" in props:
    props = props.replace("expo.useLegacyPackaging=false", "expo.useLegacyPackaging=true")
    changes.append("Enabled legacy packaging (compresses .so files in APK)")
    with open(GRADLE_PROPS, "w") as f:
        f.write(props)

# ── 6. Add ABI splits to strip all non-arm64-v8a native libs ────────────
abi_split_block = """
    splits {
        abi {
            enable true
            reset()
            include 'arm64-v8a'
            universalApk false
        }
    }
"""
# Insert before androidResources block
if "splits {" not in content:
    content = content.replace(
        "    androidResources {",
        abi_split_block + "\n    androidResources {"
    )
    changes.append("Added ABI splits for arm64-v8a only")

# ── 7. Rename ic_launcher .webp → .png (they're actually PNGs with wrong ext) ─
# expo prebuild generates .webp files that contain PNG data. Android installer
# sees the .webp extension and fails to decode → blurry icon on install screen.
ICON_DIR = "android/app/src/main/res"
for root, dirs, files in os.walk(ICON_DIR):
    for f in files:
        if f.startswith("ic_launcher") and f.endswith(".webp"):
            path = os.path.join(root, f)
            # Check if it's actually a PNG (magic bytes: 89 50 4E 47)
            with open(path, "rb") as fh:
                header = fh.read(4)
            if header == b'\x89PNG':
                new_path = path.replace(".webp", ".png")
                if not os.path.exists(new_path):
                    os.rename(path, new_path)
                    changes.append(f"Renamed {f} → .png (was PNG with wrong extension)")

# ── 8. Remove duplicate PNG launcher icons (PNG + WEBP conflict) ──────────
# NOTE: We KEEP ic_launcher.png and ic_launcher_round.png in PNG format because
# Android package installer / loading screen does NOT handle WEBP icons properly
# (shows blurry/low-res icon during APK installation).
KEEP_PREFIXES = ("ic_launcher.", "ic_launcher_round.")
RES_DIR = "android/app/src/main/res"
png_dupes = []
for root, dirs, files in os.walk(RES_DIR):
    for f in files:
        if f.endswith(".png") and f.replace(".png", ".webp") in files:
            if any(f.startswith(p) for p in KEEP_PREFIXES):
                # Also remove the WEBP version (keep PNG for installer compat)
                webp_path = os.path.join(root, f.replace(".png", ".webp"))
                if os.path.exists(webp_path):
                    os.remove(webp_path)
                    changes.append(f"Removed WEBP (keep PNG for installer): {os.path.basename(webp_path)}")
            else:
                path = os.path.join(root, f)
                png_dupes.append(path)

for path in png_dupes:
    os.remove(path)
    changes.append(f"Removed duplicate PNG (WEBP exists): {os.path.basename(path)}")

# ── 9. Strip biometric permissions from AndroidManifest ───────────────────
# expo-secure-store's dependency (androidx.biometric) auto-injects
# USE_BIOMETRIC / USE_FINGERPRINT into the merged manifest via library AAR.
# We don't use biometric auth, and these permissions cause some devices
# (Samsung, Xiaomi, etc.) to prompt for fingerprint during APK install.
# Adding tools:node="remove" declarations tells the manifest merger to strip
# these from ALL sources (including library AARs).
MANIFEST_PATH = "android/app/src/main/AndroidManifest.xml"
if os.path.exists(MANIFEST_PATH):
    with open(MANIFEST_PATH, "r") as f:
        manifest_content = f.read()

    # Ensure tools namespace is declared
    tools_ns = 'xmlns:tools="http://schemas.android.com/tools"'
    if tools_ns not in manifest_content:
        manifest_content = manifest_content.replace(
            '<manifest ',
            '<manifest ' + tools_ns + ' '
        )

    # Add tools:node="remove" for biometric permissions (if not already present)
    remove_biometric = '<uses-permission android:name="android.permission.USE_BIOMETRIC" tools:node="remove"/>'
    remove_fingerprint = '<uses-permission android:name="android.permission.USE_FINGERPRINT" tools:node="remove"/>'

    if remove_biometric not in manifest_content:
        # Insert AFTER ACCESS_BACKGROUND_LOCATION (first permission line)
        insert_point = manifest_content.find('<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"')
        if insert_point != -1:
            line_end = manifest_content.find('\n', insert_point)
            if line_end != -1:
                indent = '  '
                manifest_content = (
                    manifest_content[:line_end + 1] +
                    f'{indent}<!-- Biometric permissions removed: androidx.biometric adds these but we do not use them -->\n'
                    f'{indent}{remove_biometric}\n'
                    f'{indent}{remove_fingerprint}\n' +
                    manifest_content[line_end + 1:]
                )
                changes.append("Added tools:node=\"remove\" for USE_BIOMETRIC/USE_FINGERPRINT")

    with open(MANIFEST_PATH, "w") as f:
        f.write(manifest_content)
    if not any("USE_BIOMETRIC" in c for c in changes):
        changes.append("USE_BIOMETRIC/USE_FINGERPRINT removal already present")

with open(BUILD_GRADLE, "w") as f:
    f.write(content)

print("✅ build.gradle fixes applied:")
for c in changes:
    print(f"   - {c}")
