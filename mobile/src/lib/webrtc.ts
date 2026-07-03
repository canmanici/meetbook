/**
 * Lazy loader for the native WebRTC + InCallManager modules.
 *
 * react-native-webrtc only exists in dev-client / release builds — Expo Go,
 * web and Jest would crash on a top-level import. Everything call-related
 * must go through these getters and tolerate a null return (feature is then
 * hidden / disabled gracefully).
 */
import { PermissionsAndroid, Platform } from 'react-native';

export type CallPermissionResult = 'granted' | 'denied' | 'blocked';

export interface WebRTCModule {
  RTCPeerConnection: any;
  RTCView: any;
  RTCSessionDescription: any;
  RTCIceCandidate: any;
  mediaDevices: {
    getUserMedia: (constraints: unknown) => Promise<any>;
  };
}

let webrtc: WebRTCModule | null | undefined;
let inCall: any | null | undefined;

export function getWebRTC(): WebRTCModule | null {
  if (webrtc === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      webrtc = require('react-native-webrtc') ?? null;
    } catch {
      webrtc = null;
    }
  }
  return webrtc ?? null;
}

/** react-native-incall-manager — audio routing (earpiece/speaker), ringtones,
 *  proximity sensor. Optional: calls still work without it, just without
 *  speaker toggle / ringback. */
export function getInCallManager(): any | null {
  if (inCall !== undefined) return inCall;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    inCall = require('react-native-incall-manager').default;
  } catch {
    inCall = null;
  }
  return inCall;
}

export function isCallSupported(): boolean {
  return getWebRTC() != null;
}

/**
 * Explicitly requests mic (+ camera for video calls) before touching
 * getUserMedia. react-native-webrtc does its own internal permission check
 * and silently skips re-requesting once a permission has been denied once,
 * so the OS popup never reappears on retry — asking ourselves via
 * PermissionsAndroid.requestMultiple guarantees the dialog shows again
 * every time the user hasn't permanently blocked it ("don't ask again").
 * No-op (always granted) on iOS: getUserMedia drives the native TCC prompt
 * there and there's no separate check/request API to call ahead of it.
 */
export async function requestCallPermissions(kind: 'audio' | 'video'): Promise<CallPermissionResult> {
  if (Platform.OS !== 'android') return 'granted';

  const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (kind === 'video') perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);

  const results = await PermissionsAndroid.requestMultiple(perms);
  const values = perms.map((p) => results[p]);

  if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  if (values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return 'blocked';
  return 'denied';
}

/** STUN-only fallback when /chat/turn-credentials is unreachable or the
 *  server has no TURN configured. Covers ~80-85% of NAT setups; two-sided
 *  CGNAT needs the TURN relay from the backend response. */
export const FALLBACK_ICE_SERVERS: { urls: string[] }[] = [
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
];
