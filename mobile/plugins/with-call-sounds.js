/**
 * Native bits for calls, applied on every prebuild:
 *
 * 1. Copies call sounds into android/app/src/main/res/raw.
 *    - incallmanager_ringback: react-native-incall-manager resolves
 *      `ringback: '_BUNDLE_'` to this raw resource. When it's missing it
 *      silently falls back to the phone's ringtone — the CALLER heard their
 *      own ringtone instead of a dial tone.
 *    - meetbook_ringtone: looping ringtone of the native incoming-call
 *      notification channel (modules/incoming-call). The in-app callee UI
 *      keeps `_DEFAULT_` (the phone's own ringtone).
 *
 * (Showing over the lock screen is done at runtime, only while a call is
 * ringing or live — modules/incoming-call. Never set it in the manifest.)
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SOUNDS = ['incallmanager_ringback.mp3', 'meetbook_ringtone.ogg'];

function withSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/raw');
      fs.mkdirSync(rawDir, { recursive: true });
      for (const name of SOUNDS) {
        fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'assets/sounds', name), path.join(rawDir, name));
      }
      // Resolved by name at runtime (getIdentifier) — survive resource shrinking.
      fs.writeFileSync(
        path.join(rawDir, 'keep.xml'),
        '<?xml version="1.0" encoding="utf-8"?>\n' +
          '<resources xmlns:tools="http://schemas.android.com/tools"\n' +
          '    tools:keep="@raw/meetbook_ringtone,@raw/incallmanager_ringback" />\n',
      );
      return cfg;
    },
  ]);
}

module.exports = function withCallSounds(config) {
  return withSounds(config);
};
