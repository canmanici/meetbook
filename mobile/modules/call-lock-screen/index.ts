import { requireOptionalNativeModule } from 'expo-modules-core';

type CallLockScreenNative = {
  arm(durationMs: number): boolean;
  disarm(): boolean;
};

// Optional: absent in Expo Go, web and Jest — calls become no-ops.
const native = requireOptionalNativeModule<CallLockScreenNative>('CallLockScreen');

/** Let the app show over the lock screen (ringing/live call) for durationMs. */
export function armCallLockScreen(durationMs: number): void {
  try { native?.arm(durationMs); } catch {}
}

/** Call is over: normal lock-screen behaviour again. */
export function disarmCallLockScreen(): void {
  try { native?.disarm(); } catch {}
}
