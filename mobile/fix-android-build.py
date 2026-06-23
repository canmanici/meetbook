#!/usr/bin/env python3
"""
Fix android/app/build.gradle after `expo prebuild`:
  1. Fix the malformed signingConfigs block (nested release inside debug)
  2. Add ndk abiFilters for arm64-v8a only
  3. Fix duplicate signingConfig lines in debug buildType
  4. Enable R8 minification and resource shrinking for release
"""
import re, os, sys

BUILD_GRADLE = "android/app/build.gradle"

with open(BUILD_GRADLE, "r") as f:
    content = f.read()

changes = []

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

with open(BUILD_GRADLE, "w") as f:
    f.write(content)

print("✅ build.gradle fixes applied:")
for c in changes:
    print(f"   - {c}")
