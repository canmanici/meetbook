/**
 * Copies call sounds into android/app/src/main/res/raw on every prebuild.
 *
 * react-native-incall-manager resolves `ringback: '_BUNDLE_'` to the raw
 * resource `incallmanager_ringback`. When that resource is missing it silently
 * falls back to Settings.System.DEFAULT_RINGTONE_URI — so the CALLER heard
 * their own phone's ringtone instead of a dial tone. Shipping the file makes
 * the ringback a fixed 450 Hz "düt… düt…" on every device.
 *
 * The callee side intentionally keeps `_DEFAULT_` (the phone's own ringtone).
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SOUNDS = ['incallmanager_ringback.mp3'];

module.exports = function withCallSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/raw');
      fs.mkdirSync(rawDir, { recursive: true });
      for (const name of SOUNDS) {
        fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'assets/sounds', name), path.join(rawDir, name));
      }
      return cfg;
    },
  ]);
};
