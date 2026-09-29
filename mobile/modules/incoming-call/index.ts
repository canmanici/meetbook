import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeIncomingCall = {
  callId: string;
  chatId: string;
  kind: 'audio' | 'video';
  callerName: string;
  /** Absolute URL of the caller's photo ('' = none); GIFs animate. */
  callerAvatarUrl: string;
  /** Epoch ms when the caller's ring window ends. */
  expiresAt: number;
};

type IncomingCallNative = {
  show(options: NativeIncomingCall & { quiet: boolean }): boolean;
  cancel(callId: string | null): boolean;
  getActive(): NativeIncomingCall | null;
  takePendingAction(): { callId: string; action: 'answer' | 'decline' } | null;
  setAuth(apiBase: string, accessToken: string): boolean;
  clearAuth(): boolean;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): boolean;
  isXiaomi(): boolean;
  openXiaomiPermissions(): boolean;
  addListener?(
    event: 'onCallAction',
    cb: (e: { callId: string; action: 'answer' | 'decline' }) => void,
  ): { remove(): void };
};

// Optional: absent in Expo Go, web and Jest — every call becomes a no-op.
const native = requireOptionalNativeModule<IncomingCallNative>('IncomingCall');

export const isIncomingCallNativeAvailable = native != null;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return native ? fn() : fallback;
  } catch {
    return fallback;
  }
}

/** Ringing CallStyle notification (full-screen on a locked phone). */
export function showNativeIncomingCall(call: NativeIncomingCall, quiet = false): void {
  safe(() => native!.show({ ...call, quiet }), false);
}

export function cancelNativeIncomingCall(callId: string | null): void {
  safe(() => native!.cancel(callId), false);
}

export function getNativeActiveCall(): NativeIncomingCall | null {
  return safe(() => native!.getActive(), null);
}

export function takeNativePendingAction(): { callId: string; action: 'answer' | 'decline' } | null {
  return safe(() => native!.takePendingAction(), null);
}

/** Lets the native "Reddet" call POST /chat/calls/decline with no JS running. */
export function setNativeCallAuth(apiBase: string, accessToken: string): void {
  safe(() => native!.setAuth(apiBase, accessToken), false);
}

export function clearNativeCallAuth(): void {
  safe(() => native!.clearAuth(), false);
}

/** Android 14+: false when full-screen calls on a locked phone are blocked. */
export function canUseFullScreenIntent(): boolean {
  return safe(() => native!.canUseFullScreenIntent(), true);
}

export function openFullScreenIntentSettings(): void {
  safe(() => native!.openFullScreenIntentSettings(), false);
}

export function isXiaomiDevice(): boolean {
  return safe(() => native!.isXiaomi(), false);
}

/** Xiaomi "Show on lock screen" / "pop-up windows" permission page. */
export function openXiaomiPermissions(): void {
  safe(() => native!.openXiaomiPermissions(), false);
}

/** Fires when the call was declined natively (notification / call screen)
 * while JS is running, so the call store can drop its ringing state. */
export function addCallActionListener(
  cb: (e: { callId: string; action: 'answer' | 'decline' }) => void,
): () => void {
  try {
    const sub = native?.addListener?.('onCallAction', cb);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}
